import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  AgentEvent,
  AgentRunResult,
  AgentRunSpec,
  AgentRunner,
  AgentToolCallRecord,
  ContentBlock,
} from './agent-runner.ts';
import type { AgentSession, SessionOptions } from './agent-runner.ts';
import { prependSystemPrompt, trackChildExit } from './agent-runner.ts';
import { buildChildEnv } from './agent-env.ts';
import { disclaimedCommand } from './disclaim-spawn.ts';
import { AUTO_END_DELAY_MS, DEFAULT_RUN_TIMEOUT_MS } from './claude-cli-runner.ts';
import { parseModelIdentity } from './model-identity.ts';
import { V1TextCoalescer } from './v1-text-coalescer.ts';
import {
  OpencodeTransportError,
  openOpencodeEventStream,
  opencodeRequest,
} from './opencode-http.ts';
import {
  createOpencodeUiState,
  opencodeSessionStarted,
  opencodeTurnStarted,
  type OpencodeUiMapperState,
} from './opencode-ui-mapper.ts';
import { mapOpencodeV2Event } from './opencode-v2-ui-mapper.ts';
import { KILL_GRACE_MS, TURN_IDLE_GRACE_MS } from './opencode-server-runner.ts';

export interface OpencodeV2RunnerOptions {
  /** Override the binary name/path; defaults to `opencode` on PATH. */
  bin?: string;
  /** Wall-clock timeout for a run (ms); per-spec `timeoutMs` still wins. */
  timeoutMs?: number;
}

const SERVER_START_TIMEOUT_MS = 30_000;

/**
 * `AgentRunner` over `opencode serve` v2 — OpenCode version 2.x with updated protocol.
 * 
 * This runner handles OpenCode v2's revised API endpoints and event schema while
 * maintaining the same session-based architecture as v1. Key differences:
 * - Endpoints prefixed with `/v2/`
 * - Model format: `{ provider, model }` instead of `{ providerID, modelID }`
 * - Revised SSE event types and structure
 * 
 * Like v1, one server per session bound to the run's worktree. Auth = host's opencode
 * config. Auto-approved permissions. `spec.allowedTools` ignored (OpenCode has no
 * per-tool allowlist). `spec.model` is `provider/model`.
 */
export class OpencodeV2ServerRunner implements AgentRunner {
  readonly backend = 'opencode' as const;

  private readonly bin: string;
  private readonly timeoutMs: number;
  private lastSession: OpencodeV2Session | null = null;

  constructor(opts: OpencodeV2RunnerOptions = {}) {
    this.bin = opts.bin ?? process.env.CEZ_OPENCODE_BIN ?? 'opencode';
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
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
    const session = new OpencodeV2Session(this.bin, this.timeoutMs, spec, onEvent, opts);
    this.lastSession = session;
    return session;
  }
}

/** One live `opencode serve` v2 process driving a single session. */
class OpencodeV2Session implements AgentSession {
  readonly result: Promise<AgentRunResult>;

  private readonly child!: ChildProcessWithoutNullStreams;
  private readonly hasExited: () => boolean;
  private serverOpen = true;
  private baseUrl: string | undefined;
  private sessionId: string | undefined;
  private ready!: Promise<void>;
  private resolveExit!: () => void;
  private exited!: Promise<void>;
  private readonly sse = new AbortController();
  private readonly toolCalls: AgentToolCallRecord[] = [];
  private readonly textChunks: string[] = [];
  private readonly textSeen = new Map<string, number>();
  private readonly textCoalescer = new V1TextCoalescer((text) => {
    this.textChunks.push(text);
    this.emit({ type: 'text', text });
  });
  private readonly toolsSeen = new Set<string>();
  private readonly msgRole = new Map<string, string>();
  private tokensUsed = 0;
  private lastCost: number | undefined;
  private turnInFlight = false;
  private turnPostSettled = false;
  private endTurn: (() => void) | undefined;
  private turnGraceTimer: NodeJS.Timeout | undefined;
  private turnDropped: string | undefined;
  private sseConnected = false;
  private sseClosed = false;
  private uiState: OpencodeUiMapperState = createOpencodeUiState();
  private autoEndTimer: NodeJS.Timeout | undefined;
  private spawnFailed: Error | null = null;
  private timedOut = false;
  private signalled = false;

  constructor(
    private readonly bin: string,
    timeoutMs: number,
    private readonly spec: AgentRunSpec,
    private readonly onEvent: ((event: AgentEvent) => void) | undefined,
    private readonly opts: SessionOptions,
  ) {
    const port = 40000 + Math.floor(Math.random() * 20000);
    try {
      const env = buildChildEnv({ backend: 'opencode', extraEnv: spec.env });
      const [file, argv] = disclaimedCommand(bin, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], env);
      this.child = nodeSpawn(file, argv, { cwd: spec.cwd, env });
    } catch (err) {
      throw wrapSpawnError(err, bin);
    }
    this.hasExited = trackChildExit(this.child);

    this.child.on('error', (err: NodeJS.ErrnoException) => {
      this.spawnFailed = wrapSpawnError(err, bin);
    });

    this.exited = new Promise<void>((resolve) => {
      this.resolveExit = resolve;
    });
    this.child.once('exit', () => {
      this.finishTurn();
      this.resolveExit();
    });
    this.child.once('close', () => {
      this.finishTurn();
      this.resolveExit();
    });

    const stderrChunks: string[] = [];
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => stderrChunks.push(chunk));

    const urlReady = this.waitForServerUrl(port);

    const limitMs = spec.timeoutMs ?? timeoutMs;
    let deadline: NodeJS.Timeout | undefined;
    if (limitMs > 0) {
      deadline = setTimeout(() => {
        this.timedOut = true;
        this.interrupt();
      }, limitMs);
      deadline.unref?.();
    }

    this.ready = (async () => {
      this.baseUrl = await urlReady;
      await this.bootstrap();
    })();

    this.result = (async (): Promise<AgentRunResult> => {
      try {
        await this.ready;
        await this.exited;
      } catch (err) {
        if (!this.timedOut) {
          const message = err instanceof Error ? err.message : String(err);
          this.emit({ type: 'error', message: `opencode v2: ${message}` });
        }
      } finally {
        if (deadline) clearTimeout(deadline);
        if (this.autoEndTimer) clearTimeout(this.autoEndTimer);
        this.sse.abort();
        this.serverOpen = false;
        this.terminate();
      }

      await this.exited;
      if (this.spawnFailed) throw this.spawnFailed;

      this.textCoalescer.flush();
      const text = this.textChunks.join('\n').trim();
      const base: AgentRunResult = {
        text,
        toolCalls: this.toolCalls,
        tokensUsed: this.tokensUsed,
        sessionId: this.sessionId ?? spec.sessionId,
      };
      if (this.timedOut) {
        const mins = Math.round((limitMs / 60_000) * 10) / 10;
        this.emit({ type: 'error', message: `opencode v2 timed out after ${mins}m and was killed` });
      }
      this.emit({ type: 'done' });
      return base;
    })();
  }

  get open(): boolean {
    return this.serverOpen;
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  sendMessage(content: ContentBlock[]): boolean {
    if (!this.serverOpen) return false;
    if (this.autoEndTimer) {
      clearTimeout(this.autoEndTimer);
      this.autoEndTimer = undefined;
    }
    const text = textOf(content);
    if (!text) return true;
    void this.ready
      .then(() => this.prompt(text))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.emit({ type: 'note', message: `opencode v2: prompt failed: ${message}` });
      });
    return true;
  }

  end(): void {
    if (!this.serverOpen) return;
    this.serverOpen = false;
    this.finishTurn();
    this.sse.abort();
    this.terminate();
  }

  interrupt(): void {
    this.serverOpen = false;
    if (this.baseUrl && this.sessionId) {
      void this.http('POST', `/v2/session/${this.sessionId}/abort`, undefined).catch(() => undefined);
    }
    this.finishTurn();
    this.sse.abort();
    this.terminate();
  }

  hardStop(): void {
    this.interrupt();
  }

  private terminate(): void {
    if (this.signalled || this.hasExited()) return;
    this.signalled = true;
    this.child.kill('SIGTERM');
    setTimeout(() => {
      if (this.hasExited()) return;
      this.child.kill('SIGKILL');
    }, KILL_GRACE_MS).unref?.();
  }

  // ---- server lifecycle ---------------------------------------------------

  private waitForServerUrl(fallbackPort: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => {
        cleanup();
        resolve(`http://127.0.0.1:${fallbackPort}`);
      }, SERVER_START_TIMEOUT_MS);
      timer.unref?.();
      const onData = (chunk: string) => {
        buffer += chunk;
        const m = /https?:\/\/[\d.]+:\d+/.exec(buffer);
        if (m) {
          cleanup();
          resolve(m[0]);
        }
      };
      const onExit = () => {
        cleanup();
        reject(new Error('opencode v2 serve exited before it started listening'));
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.child.stdout.off('data', onData);
        this.child.off('exit', onExit);
      };
      this.child.stdout.setEncoding('utf8');
      this.child.stdout.on('data', onData);
      this.child.once('exit', onExit);
    });
  }

  private async bootstrap(): Promise<void> {
    // v2 endpoint
    const created = await this.http('POST', '/v2/session', { title: 'cezar task' });
    this.sessionId = stringField(created, 'id');
    if (!this.sessionId) throw new Error('opencode v2 did not return a session id');
    this.emit({ type: 'session', sessionId: this.sessionId });
    const sessionId = this.sessionId;
    this.emitUi((state) => opencodeSessionStarted(sessionId, state));

    await this.consumeEvents();

    const first = prependSystemPrompt(this.spec.systemPrompt, this.spec.userPrompt);
    await this.prompt(first);
  }

  private async prompt(text: string): Promise<void> {
    if (!this.sessionId) return;
    this.finishTurn();
    if (this.autoEndTimer) {
      clearTimeout(this.autoEndTimer);
      this.autoEndTimer = undefined;
    }
    this.turnInFlight = true;
    this.turnPostSettled = false;
    this.turnDropped = undefined;
    const turnEnded = new Promise<void>((resolve) => {
      this.endTurn = resolve;
    });
    this.emitUi(opencodeTurnStarted);
    
    const body: Record<string, unknown> = { parts: [{ type: 'text', text }] };
    const id = parseModelIdentity(this.spec.model);
    // v2 model format
    if (id) body.model = { provider: id.provider, model: id.model };
    
    let failure: unknown;
    try {
      // v2 endpoint
      const res = await this.http('POST', `/v2/session/${this.sessionId}/message`, body);
      this.absorbUsage(res);
    } catch (err) {
      if (this.isDropWhileSessionLives(err)) {
        this.turnDropped = err instanceof Error ? err.message : String(err);
      } else {
        failure = err;
      }
    }
    this.turnPostSettled = true;
    if (failure !== undefined) {
      this.finishTurn();
      throw failure;
    }
    this.armTurnGrace();
    await turnEnded;
  }

  private finishTurn(fromIdle = false): void {
    if (!this.turnInFlight) return;
    this.turnInFlight = false;
    if (this.turnGraceTimer) {
      clearTimeout(this.turnGraceTimer);
      this.turnGraceTimer = undefined;
    }
    const dropped = this.turnDropped;
    this.turnDropped = undefined;
    this.textCoalescer.flush();
    if (dropped !== undefined && !fromIdle) {
      this.emit({ type: 'note', message: `opencode v2: prompt failed: ${dropped}` });
    }
    this.emit({ type: 'turn-end' });
    if (this.opts.autoEndAfterFirstTurn && this.serverOpen && !this.autoEndTimer) {
      this.autoEndTimer = setTimeout(() => this.end(), AUTO_END_DELAY_MS);
      this.autoEndTimer.unref?.();
    }
    const resolve = this.endTurn;
    this.endTurn = undefined;
    resolve?.();
  }

  private armTurnGrace(): void {
    if (!this.turnInFlight || !this.turnPostSettled) return;
    if (this.turnGraceTimer) {
      clearTimeout(this.turnGraceTimer);
      this.turnGraceTimer = undefined;
    }
    if (!this.sseConnected || this.sseClosed) {
      this.finishTurn();
      return;
    }
    this.turnGraceTimer = setTimeout(() => this.finishTurn(), TURN_IDLE_GRACE_MS);
    this.turnGraceTimer.unref?.();
  }

  private isDropWhileSessionLives(err: unknown): boolean {
    if (!(err instanceof OpencodeTransportError)) return false;
    if (!this.serverOpen || this.hasExited()) return false;
    return this.sseConnected && !this.sseClosed;
  }

  // ---- SSE stream ---------------------------------------------------------

  private async consumeEvents(): Promise<void> {
    if (!this.baseUrl) return;
    // v2 event endpoint
    this.sseConnected = await openOpencodeEventStream(`${this.baseUrl}/v2/events`, {
      signal: this.sse.signal,
      onFrame: (frame) => this.handleFrame(frame),
      onClose: () => {
        this.sseClosed = true;
        this.armTurnGrace();
      },
    });
  }

  private handleFrame(frame: string): void {
    const dataLines = frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim());
    if (dataLines.length === 0) return;
    let evt: OpencodeV2Event;
    try {
      evt = JSON.parse(dataLines.join('\n')) as OpencodeV2Event;
    } catch {
      return;
    }
    // Use v2 mapper
    this.emitUi((state) => mapOpencodeV2Event(evt, state));
    this.handleEvent(evt);
  }

  private handleEvent(evt: OpencodeV2Event): void {
    const type = evt.type ?? '';
    const props = evt.properties ?? evt.data ?? {};
    
    // v2 event handling (similar structure to v1 but adapted for v2 event types)
    if (type === 'message.updated' || type === 'message.created' || type === 'message.completed') {
      const info = (props.info as Record<string, unknown>) ?? props;
      const mid = stringField(info, 'id');
      const role = stringField(info, 'role');
      if (mid && role) this.msgRole.set(mid, role);
      this.absorbUsage(info);
      this.armTurnGrace();
    } else if (type === 'message.part.updated' || type === 'message.part.created' || type === 'message.content') {
      this.handlePart((props.part as Record<string, unknown>) ?? props);
      this.armTurnGrace();
    } else if (type === 'session.idle' || type === 'turn.completed') {
      const sid = stringField(props, 'sessionID');
      if (sid === undefined || sid === this.sessionId) this.finishTurn(true);
    }
  }

  private handlePart(part: Record<string, unknown>): void {
    const messageID = stringField(part, 'messageID');
    if (messageID && this.msgRole.get(messageID) !== 'assistant') return;
    const kind = stringField(part, 'type');
    const id = stringField(part, 'id') ?? stringField(part, 'partId') ?? messageID ?? '';
    
    if (kind === 'text') {
      const full = stringField(part, 'text') ?? stringField(part, 'content') ?? '';
      const seen = this.textSeen.get(id) ?? 0;
      if (full.length > seen) {
        this.textSeen.set(id, full.length);
        this.textCoalescer.append(id, full.slice(seen));
      }
      const time = part.time as Record<string, unknown> | undefined;
      if (time && typeof time === 'object' && typeof time.end === 'number') {
        this.textCoalescer.complete(id, full);
      }
    } else if (kind === 'tool') {
      const state = (part.state as Record<string, unknown> | undefined) ?? {};
      const status = stringField(state, 'status');
      const name = stringField(part, 'tool') ?? stringField(part, 'name') ?? 'tool';
      const callId = id || `${name}-${this.toolsSeen.size}`;
      if (!this.toolsSeen.has(callId)) {
        this.toolsSeen.add(callId);
        this.toolCalls.push({ id: callId, name, input: state.input ?? state });
        this.emit({ type: 'tool-call', id: callId, tool: name, input: state.input ?? state });
      }
      if (status === 'completed' || status === 'error') {
        this.emit({
          type: 'tool-result',
          toolCallId: callId,
          result: safeStringify(state.output ?? state.result ?? state),
          isError: status === 'error',
        });
      }
    }
  }

  private absorbUsage(info: Record<string, unknown> | undefined): void {
    if (!info) return;
    const tokens = info.tokens as Record<string, unknown> | undefined;
    if (tokens) {
      const input = numField(tokens, 'input') ?? numField(tokens, 'inputTokens');
      const output = numField(tokens, 'output') ?? numField(tokens, 'outputTokens');
      const reasoning = numField(tokens, 'reasoning') ?? numField(tokens, 'reasoningTokens');
      const total = input + output + reasoning;
      if (total > this.tokensUsed) {
        this.tokensUsed = total;
        this.emit({ type: 'token-usage', tokensUsed: this.tokensUsed });
      }
    }
    const cost = info.cost ?? info.usd;
    if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 && (this.lastCost === undefined || cost > this.lastCost)) {
      this.emit({ type: 'cost', usd: cost - (this.lastCost ?? 0) });
      this.lastCost = cost;
    }
  }

  // ---- http ---------------------------------------------------------------

  private async http(
    method: string,
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    if (!this.baseUrl) throw new Error('opencode v2 server not ready');
    const res = await opencodeRequest(`${this.baseUrl}${path}`, { method, body });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`${method} ${path} → ${res.status} ${res.body.slice(0, 200)}`);
    }
    if (!res.body) return {};
    try {
      return JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private emit(event: AgentEvent): void {
    this.onEvent?.(event);
  }

  private emitUi(map: (state: OpencodeUiMapperState) => { state: OpencodeUiMapperState; events: any[] }): void {
    try {
      const mapped = map(this.uiState);
      this.uiState = mapped.state;
      if (this.opts.onUiEvent) {
        for (const event of mapped.events) this.opts.onUiEvent(event);
      }
    } catch {
      // v2 mapping is best-effort; v1 consumers stay unaffected.
    }
  }
}

// ---- helpers --------------------------------------------------------------

interface OpencodeV2Event {
  type?: string;
  properties?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

function textOf(content: ContentBlock[]): string {
  return content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function numField(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  return typeof v === 'number' ? v : 0;
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function wrapSpawnError(err: unknown, bin: string): Error {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') {
    return new Error(
      `\`${bin}\` not found on PATH — install OpenCode (https://opencode.ai) and run \`opencode\` once to configure a provider`,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}
