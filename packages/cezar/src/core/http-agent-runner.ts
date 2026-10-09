/**
 * HTTP Agent Runner — treats any OpenAI-compatible endpoint as a backend.
 *
 * No CLI needed, just HTTP. Enables using free-tier providers (Groq, DeepInfra),
 * local models (Ollama, LM Studio), or custom endpoints for planning/review tasks.
 *
 * Configuration lives in agent accounts (`~/.cezar/agent-accounts.json`) under
 * provider 'http', with the endpoint URL and optional API key in the configDir
 * field as a JSON object.
 */

import type {
  AgentBackend,
  AgentEvent,
  AgentRunResult,
  AgentRunSpec,
  AgentRunner,
  AgentSession,
  ContentBlock,
  SessionOptions,
} from './agent-runner.ts';
import type { UiEvent } from './ui-events.ts';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

interface OpenAIChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

interface HttpAgentConfig {
  endpoint: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

function parseHttpConfig(configDir: string | null | undefined): HttpAgentConfig | null {
  if (!configDir?.trim()) return null;
  try {
    const config = JSON.parse(configDir) as Partial<HttpAgentConfig>;
    if (!config.endpoint) return null;
    return {
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      model: config.model || 'gpt-3.5-turbo',
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 4096,
    };
  } catch {
    return null;
  }
}

class HttpAgentSession implements AgentSession {
  private closed = false;
  private readonly abortController = new AbortController();
  private readonly messages: OpenAIMessage[] = [];
  private readonly events: AgentEvent[] = [];
  private tokensUsed = 0;
  private readonly config: HttpAgentConfig;
  private readonly onEvent?: (event: AgentEvent) => void;
  private readonly onUiEvent?: (event: UiEvent) => void;
  private readonly spec: AgentRunSpec;
  private sessionId: string;
  private currentTurn?: Promise<void>;

  readonly result: Promise<AgentRunResult>;
  readonly pid = undefined;

  constructor(
    spec: AgentRunSpec,
    config: HttpAgentConfig,
    onEvent?: (event: AgentEvent) => void,
    opts?: SessionOptions,
  ) {
    this.spec = spec;
    this.config = config;
    this.onEvent = onEvent;
    this.onUiEvent = opts?.onUiEvent;
    this.sessionId = spec.sessionId || `http-${Date.now()}`;

    // Build initial messages
    if (spec.systemPrompt) {
      this.messages.push({ role: 'system', content: spec.systemPrompt });
    }

    // Convert user prompt + images to OpenAI format
    const userContent = this.buildUserContent(spec.userPrompt, spec.images);
    this.messages.push({ role: 'user', content: userContent });

    // Emit session event
    this.emit({ type: 'session', sessionId: this.sessionId });

    // Start the conversation
    this.result = this.run(opts?.autoEndAfterFirstTurn ?? false);
  }

  private buildUserContent(
    text: string,
    images?: ContentBlock[],
  ): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
    if (!images || images.length === 0) return text;

    const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
      { type: 'text', text },
    ];

    for (const block of images) {
      if (block.type === 'image') {
        const dataUrl = `data:${block.source.media_type};base64,${block.source.data}`;
        content.push({ type: 'image_url', image_url: { url: dataUrl } });
      }
    }

    return content;
  }

  private emit(event: AgentEvent): void {
    this.events.push(event);
    this.onEvent?.(event);

    // Map to UI events
    const uiEvent = this.toUiEvent(event);
    if (uiEvent) this.onUiEvent?.(uiEvent);
  }

  private toUiEvent(event: AgentEvent): UiEvent | null {
    switch (event.type) {
      case 'text':
        return { type: 'item.delta', itemId: 'message-0', field: 'text', delta: event.text };
      case 'turn-end':
        return null; // Simple text streaming doesn't need turn completion events
      case 'done':
        return { type: 'session.ended', reason: 'end_turn' };
      case 'error':
        return { type: 'session.ended', reason: 'error' };
      default:
        return null;
    }
  }

  private async run(autoEnd: boolean): Promise<AgentRunResult> {
    try {
      await this.executeTurn();

      if (autoEnd) {
        this.closed = true;
      }

      this.emit({ type: 'done' });

      return {
        text: this.events
          .filter((e): e is Extract<AgentEvent, { type: 'text' }> => e.type === 'text')
          .map((e) => e.text)
          .join('')
          .trim(),
        toolCalls: [],
        tokensUsed: this.tokensUsed,
        sessionId: this.sessionId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ type: 'error', message });
      throw error;
    }
  }

  private async executeTurn(): Promise<void> {
    const request: OpenAIChatCompletionRequest = {
      model: this.config.model!,
      messages: this.messages,
      stream: true,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    let assistantMessage = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter((line) => line.trim().startsWith('data: '));

        for (const line of lines) {
          const data = line.replace(/^data: /, '').trim();
          if (data === '[DONE]') continue;
          if (!data) continue;

          try {
            const parsed = JSON.parse(data) as OpenAIChatCompletionChunk;
            const delta = parsed.choices[0]?.delta;
            if (delta?.content) {
              assistantMessage += delta.content;
              this.emit({ type: 'text', text: delta.content });
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Add assistant message to history
    this.messages.push({ role: 'assistant', content: assistantMessage });

    // Emit turn-end
    this.emit({ type: 'turn-end' });

    // Estimate token usage (rough approximation: 1 token ≈ 4 chars)
    const totalChars = this.messages.reduce((sum, msg) => {
      const content = typeof msg.content === 'string' ? msg.content : msg.content.map((c) => 'text' in c ? c.text : '').join('');
      return sum + content.length;
    }, 0);
    this.tokensUsed = Math.ceil(totalChars / 4);
    this.emit({ type: 'token-usage', tokensUsed: this.tokensUsed });
  }

  sendMessage(content: ContentBlock[]): boolean {
    if (this.closed) return false;

    const userContent = this.buildUserContent(
      content.filter((c): c is Extract<ContentBlock, { type: 'text' }> => c.type === 'text')
        .map((c) => c.text)
        .join('\n'),
      content.filter((c): c is Extract<ContentBlock, { type: 'image' }> => c.type === 'image'),
    );

    this.messages.push({ role: 'user', content: userContent });

    // Execute next turn
    this.currentTurn = this.executeTurn().catch((error) => {
      this.emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    });

    return true;
  }

  end(): void {
    this.closed = true;
    this.abortController.abort();
  }

  interrupt(): void {
    this.end();
  }

  get open(): boolean {
    return !this.closed;
  }
}

export class HttpAgentRunner implements AgentRunner {
  readonly backend: AgentBackend = 'http' as AgentBackend;
  private currentSession?: HttpAgentSession;

  async run(spec: AgentRunSpec, onEvent?: (event: AgentEvent) => void): Promise<AgentRunResult> {
    const session = this.startSession(spec, onEvent, { autoEndAfterFirstTurn: true });
    return session.result;
  }

  startSession(
    spec: AgentRunSpec,
    onEvent?: (event: AgentEvent) => void,
    opts?: SessionOptions,
  ): AgentSession {
    // Parse config from env or spec
    const configFromEnv = parseHttpConfig(process.env.CEZ_HTTP_AGENT_CONFIG);
    const configFromSpec = parseHttpConfig(spec.env?.CEZ_HTTP_AGENT_CONFIG);
    const config = configFromSpec || configFromEnv;

    if (!config) {
      throw new Error(
        'HTTP agent not configured. Set CEZ_HTTP_AGENT_CONFIG with endpoint and optional apiKey. ' +
        'Example: {"endpoint":"https://api.groq.com/openai/v1/chat/completions","apiKey":"gsk_...","model":"mixtral-8x7b-32768"}',
      );
    }

    // Use model from spec if provided
    if (spec.model) {
      config.model = spec.model;
    }

    this.currentSession = new HttpAgentSession(spec, config, onEvent, opts);
    return this.currentSession;
  }

  async interrupt(): Promise<void> {
    this.currentSession?.interrupt();
  }
}
