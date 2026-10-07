import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isSignalTerminationExit,
  prependSystemPrompt,
  trackChildExit,
  type AgentBackend,
  type AgentEvent,
  type AgentRunResult,
  type AgentRunSpec,
  type AgentRunner,
  type AgentSession,
  type ContentBlock,
  type SessionOptions,
} from './agent-runner.ts';
import { buildChildEnv } from './agent-env.ts';
import { readNdjson } from './ndjson.ts';
import { EOF_KILL_GRACE_MS, EOF_TERM_GRACE_MS } from './claude-cli-runner.ts';
import type { UiEvent } from './ui-events.ts';
import { V1TextCoalescer } from './v1-text-coalescer.ts';

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const AUTO_END_DELAY_MS = 250;

export interface AntigravityRunnerOptions {
  /** Override the binary; defaults to `agy` on PATH (`CEZ_ANTIGRAVITY_BIN`). */
  bin?: string;
  /** Wall-clock timeout for a run (ms); per-spec `timeoutMs` still wins. */
  timeoutMs?: number;
}

/**
 * `AgentRunner` over Google Antigravity CLI (`agy`) — the terminal interface for
 * Antigravity 2.0 agent harness. Uses `agy --headless --json-output` mode for
 * programmatic integration.
 *
 * Antigravity CLI provides:
 * - Multi-step reasoning and planning
 * - Multi-file editing with review gates
 * - Tool calling (bash, file operations)
 * - Persistent conversation history
 * - Shared agent engine with Antigravity 2.0 IDE
 *
 * Authentication: Antigravity uses Google account via system keyring or browser OAuth.
 * The CLI must be authenticated before use: `agy` (first launch triggers auth flow).
 *
 * Transport: JSON-structured events over stdout, similar to stream-json but with
 * Antigravity-specific event types. Not standard ACP, but inspired by it.
 *
 * Permissions: Antigravity uses artifact review policy (`artifactReviewPolicy`):
 * - "asks-for-review" (default): prompts before writing code
 * - "agent-decides": dynamic prompting
 * - "always-proceed": never prompts (auto-approval)
 *
 * For cezar integration, we use "always-proceed" to match the zero-config auto-approval
 * posture (#430).
 */
export class AntigravityRunner implements AgentRunner {
  readonly backend = 'antigravity' as any;

  private readonly bin: string;
  private readonly timeoutMs: number;
  private lastSession: AgentSession | null = null;

  constructor(opts: AntigravityRunnerOptions = {}) {
    this.bin =
      opts.bin ?? process.env.CEZ_ANTIGRAVITY_BIN ?? (process.env.CEZ_DRY_RUN === '1' ? mockAntigravityPath() : 'agy');
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  run(spec: AgentRunSpec, onEvent?: (event: AgentEvent) => void): Promise<AgentRunResult> {
    return this.startSession(spec, onEvent, { autoEndAfterFirstTurn: true }).result;
  }

  async interrupt(): Promise<void> {
    this.lastSession?.interrupt();
  }

  startSession(
    spec: AgentRunSpec,
    onEvent?: (event: AgentEvent) => void,
    opts: SessionOptions = {},
  ): AgentSession {
    const session = new AntigravitySession(this.bin, this.timeoutMs, spec, onEvent, opts);
    this.lastSession = session;
    return session;
  }
}

/**
 * CLI flags for Antigravity. From `agy --help`:
 *
 * - `--headless`: Run without TUI, output to stdout
 * - `--json-output`: Structured JSON event stream (similar to stream-json)
 * - `--artifact-review-policy=always-proceed`: Auto-approve all changes (no interactive prompts)
 * - `--model=<model>`: Model selection (optional, uses config default if omitted)
 * - `--conversation-id=<uuid>`: Resume existing conversation (session continuation)
 * - `--workspace=<path>`: Set workspace directory (cwd by default)
 * - `--log-file=<path>`: Write detailed logs for debugging
 */
export function buildAntigravityArgs(spec: AgentRunSpec & { logFile?: string }): string[] {
  const args = [
    '--headless',
    '--json-output',
    '--artifact-review-policy=always-proceed',
  ];

  if (spec.model) {
    args.push('--model', spec.model);
  }

  if (spec.sessionId) {
    args.push('--conversation-id', spec.sessionId);
  }

  if (spec.logFile) {
    args.push('--log-file', spec.logFile);
  }

  // Workspace is set via spawn cwd, not --workspace flag
  // (keeps behavior consistent with other runners)

  return args;
}

/** The per-run environment: `buildChildEnv`'s least-privilege set for this backend. */
export function buildAntigravityEnv(backend: AgentBackend, extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  return buildChildEnv({ backend, extraEnv });
}

/**
 * A cezar-authored line for an exit outside a prompt.
 * Antigravity CLI uses exit codes similar to standard UNIX conventions.
 */
export function antigravityExitMessage(exitCode: number | null, stderr: string): string {
  if (isAntigravityAuthFailure(stderr)) {
    return 'Authentication required — run `agy` to sign in with your Google account';
  }

  if (exitCode === 1 && stderr.includes('conversation not found')) {
    return 'Conversation not found — the session may have been deleted';
  }

  if (exitCode === 1 && stderr.includes('quota')) {
    return 'AI quota exceeded — check your credit balance with `agy` then type `/credits`';
  }

  const detail = stderr.trim().split('\n').slice(-3).join(' | ');
  return `Antigravity CLI exited with code ${exitCode}${detail ? ` — ${truncate(detail, 400)}` : ''}`;
}

/**
 * Check if stderr indicates an authentication failure.
 */
export function isAntigravityAuthFailure(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return (
    lower.includes('authentication') ||
    lower.includes('not authenticated') ||
    lower.includes('sign in') ||
    lower.includes('login required') ||
    lower.includes('unauthorized')
  );
}

class AntigravitySession implements AgentSession {
  readonly result: Promise<AgentRunResult>;
  readonly pid?: number;

  private readonly child: ChildProcessWithoutNullStreams;
  private readonly hasExited: () => boolean;
  private isOpen = true;
  private terminatedByCezar = false;
  private timedOut = false;
  private runTimeoutTimer: NodeJS.Timeout | null = null;

  private conversationId: string | undefined;
  private turnsCompleted = 0;
  private usage = { input: 0, output: 0 };
  private readonly textChunks: string[] = [];
  private readonly textCoalescer = new V1TextCoalescer((text) => {
    this.textChunks.push(text);
    if (this.onEvent) {
      this.onEvent({ type: 'text', text });
    }
  });

  private resolveResult!: (result: AgentRunResult) => void;
  private rejectResult!: (error: Error) => void;

  constructor(
    bin: string,
    timeoutMs: number,
    private readonly spec: AgentRunSpec,
    private readonly onEvent?: (event: AgentEvent) => void,
    private readonly opts: SessionOptions = {},
  ) {
    const args = buildAntigravityArgs(spec);
    const env = buildAntigravityEnv('antigravity' as any, spec.env);

    // Prepare stdin with system prompt + user prompt
    const fullPrompt = prependSystemPrompt(spec.systemPrompt, spec.userPrompt);

    this.child = nodeSpawn(bin, args, { cwd: spec.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.pid = this.child.pid;

    this.hasExited = trackChildExit(this.child);

    this.result = new Promise<AgentRunResult>((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });

    // Set run timeout
    if (timeoutMs > 0) {
      this.runTimeoutTimer = setTimeout(() => {
        this.timedOut = true;
        this.end();
      }, timeoutMs);
    }

    // Process stdout events - capture child in local variable to avoid TS error
    const child = this.child;
    (async () => {
      for await (const line of readNdjson(child.stdout)) {
        this.handleEvent(line);
      }
    })();

    // Handle process exit
    this.child.on('exit', (exitCode: number | null, signalCode: NodeJS.Signals | null) => {
      this.handleExit(exitCode, signalCode);
    });
    this.child.on('error', (err: Error) => {
      this.handleSpawnError(err);
    });

    // Send initial prompt to stdin
    this.child.stdin.write(fullPrompt + '\n');

    // Auto-end after first turn if requested
    if (this.opts.autoEndAfterFirstTurn) {
      setTimeout(() => {
        if (this.turnsCompleted >= 1 && this.isOpen) {
          this.end();
        }
      }, AUTO_END_DELAY_MS);
    }
  }

  get open(): boolean {
    return this.isOpen;
  }

  sendMessage(content: ContentBlock[]): boolean {
    if (!this.isOpen || this.hasExited()) return false;

    const text = content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    if (!text.trim()) return false;

    this.child.stdin.write(text + '\n');
    return true;
  }

  end(): void {
    if (!this.isOpen) return;
    this.terminatedByCezar = true;

    if (this.runTimeoutTimer) {
      clearTimeout(this.runTimeoutTimer);
      this.runTimeoutTimer = null;
    }

    // Graceful shutdown: close stdin then SIGTERM→SIGKILL watchdog
    this.child.stdin.end();

    const termTimer = setTimeout(() => {
      if (!this.hasExited()) {
        this.child.kill('SIGTERM');

        const killTimer = setTimeout(() => {
          if (!this.hasExited()) {
            this.child.kill('SIGKILL');
          }
        }, EOF_KILL_GRACE_MS);

        this.child.once('exit', () => clearTimeout(killTimer));
      }
    }, EOF_TERM_GRACE_MS);

    this.child.once('exit', () => clearTimeout(termTimer));
  }

  interrupt(): void {
    if (!this.isOpen) return;
    this.terminatedByCezar = true;

    if (this.runTimeoutTimer) {
      clearTimeout(this.runTimeoutTimer);
      this.runTimeoutTimer = null;
    }

    this.child.kill('SIGTERM');
  }

  private handleEvent(line: string): void {
    try {
      const event = JSON.parse(line) as AntigravityEvent;
      
      // Map Antigravity events to v1 AgentEvent
      this.mapToV1Event(event);

      // Map to v2 UiEvent
      this.mapToV2Event(event);

    } catch (err) {
      // Ignore malformed JSON lines
    }
  }

  private mapToV1Event(event: AntigravityEvent): void {
    switch (event.type) {
      case 'conversation.started':
        this.conversationId = event.conversationId;
        break;

      case 'message.started':
        // Agent starts responding
        break;

      case 'message.delta':
        // Text chunk
        this.textCoalescer.append(event.messageId, event.delta?.text ?? '');
        break;

      case 'tool.started':
        if (this.onEvent && event.tool) {
          this.onEvent({
            type: 'tool-call',
            id: event.tool.id ?? `tool-${Date.now()}`,
            tool: event.tool.name ?? 'unknown',
            input: event.tool.input,
          });
        }
        break;

      case 'tool.completed':
        if (this.onEvent && event.tool) {
          this.onEvent({
            type: 'tool-result',
            toolCallId: event.tool.id ?? `tool-${Date.now()}`,
            result: typeof event.tool.output === 'string' ? event.tool.output : JSON.stringify(event.tool.output),
            isError: false,
          });
        }
        break;

      case 'turn.completed':
        this.turnsCompleted++;

        // Update usage
        if (event.usage) {
          this.usage.input += event.usage.inputTokens ?? 0;
          this.usage.output += event.usage.outputTokens ?? 0;
        }

        if (this.onEvent) {
          this.onEvent({ type: 'turn-end' });
        }
        break;

      case 'error':
        if (this.onEvent) {
          this.onEvent({
            type: 'error',
            message: event.error?.message ?? 'Unknown error',
          });
        }
        break;
    }
  }

  private mapToV2Event(event: AntigravityEvent): void {
    // TODO: Implement v2 UiEvent mapping when needed
    // For now, v1 events provide backward compatibility
  }

  private handleExit(exitCode: number | null, signalCode: string | null): void {
    this.isOpen = false;

    if (this.runTimeoutTimer) {
      clearTimeout(this.runTimeoutTimer);
      this.runTimeoutTimer = null;
    }

    const stderr = this.collectStderr();

    // Graceful termination by cezar is success
    if (this.terminatedByCezar && isSignalTerminationExit(exitCode)) {
      this.resolveResult(this.buildResult('success', this.timedOut ? 'timeout' : undefined));
      return;
    }

    // Non-zero exit is failure
    if (exitCode !== 0 && exitCode !== null) {
      const message = antigravityExitMessage(exitCode, stderr);
      this.emitError(message);
      this.resolveResult(this.buildResult('failed'));
      return;
    }

    this.resolveResult(this.buildResult('success'));
  }

  private handleSpawnError(err: Error): void {
    this.isOpen = false;
    this.emitError('Failed to spawn Antigravity CLI', err);
    this.resolveResult(this.buildResult('failed'));
  }

  private buildResult(outcome: 'success' | 'failed', note?: string): AgentRunResult {
    this.textCoalescer.flush();
    return {
      text: this.textChunks.join('').trim(),
      toolCalls: [],
      tokensUsed: this.usage.input + this.usage.output,
      sessionId: this.conversationId,
    };
  }

  private collectStderr(): string {
    const chunks: Buffer[] = [];
    this.child.stderr.on('data', (chunk) => chunks.push(chunk));
    return Buffer.concat(chunks).toString('utf8');
  }

  private emitError(message: string, err?: unknown): void {
    const event: AgentEvent = {
      type: 'error',
      message: err instanceof Error ? `${message}: ${err.message}` : message,
    };
    this.onEvent?.(event);
  }
}

/**
 * Antigravity CLI event types (based on --json-output format).
 * These are similar to ACP but use Antigravity-specific naming.
 */
interface AntigravityEvent {
  type: string;
  conversationId?: string;
  messageId?: string;
  delta?: { text: string };
  tool?: {
    id?: string;
    name: string;
    input?: unknown;
    output?: string;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  stopReason?: string;
  error?: {
    message: string;
    code?: string;
  };
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
}

function mockAntigravityPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return resolvePath(dirname(thisFile), '../../test/mock/antigravity-mock.mjs');
}
