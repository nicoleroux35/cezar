import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
import { KILL_GRACE_MS } from './opencode-server-runner.ts';

export interface OpencodeV2RunnerOptions {
  /** Override the binary name/path; defaults to `opencode` on PATH. */
  bin?: string;
  /** Wall-clock timeout for a run (ms); per-spec `timeoutMs` still wins. */
  timeoutMs?: number;
}

const SERVER_START_TIMEOUT_MS = 30_000;

/**
 * `AgentRunner` over `opencode serve` for OpenCode 2.x, against the HTTP API that version
 * actually serves (verified live against 2.1.4 — `opencode serve --help` calls itself "the v2
 * API and web server"):
 *
 *   POST /api/session              { title, model: { providerID, id } } → { data: { id } }
 *   POST /api/session/:id/prompt   { text }
 *   POST /api/session/:id/interrupt
 *   GET  /api/event                SSE, one `data: {...}` per event
 *
 * Every call carries `authorization: Basic opencode:<password>`; the server prints that password
 * at boot, so this runner sets `OPENCODE_SERVER_PASSWORD` on the child instead of scraping the
 * banner — deterministic, and it cannot pin a stale password from a previous process.
 *
 * Events are the typed `session.*` bus (`session.text.delta`, `session.tool.*`,
 * `session.step.ended`, `session.execution.succeeded|failed|interrupted`), not the v1
 * `message.part.*` shape.
 *
 * One server per session bound to the run's worktree. Auto-approved permissions.
 * `spec.allowedTools` is ignored (OpenCode has no per-tool allowlist). `spec.model` is
 * `provider/model`.
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
  /** `authorization` value every call (and the event stream) must carry. */
  private readonly authHeader: string;
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
  /** `session.tool.input.started` id → tool name, for the later `called` event. */
  private readonly toolNames = new Map<string, string>();
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
    // A password of our own, set on the child rather than scraped from its banner: the server
    // answers 401 without it, and reusing whatever the printed line said would tie us to text
    // that can change between releases.
    const password = randomUUID().replaceAll('-', '');
    this.authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
    try {
      const env = buildChildEnv({ backend: 'opencode', extraEnv: { ...spec.env, OPENCODE_SERVER_PASSWORD: password } });
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
      void this.http('POST', `/api/session/${this.sessionId}/interrupt`, undefined).catch(() => undefined);
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
    const created = await this.http('POST', '/api/session', {
      title: 'cezar task',
      ...modelField(this.spec.model),
    });
    // `{ data: { id, … } }` — 2.x wraps every entity in `data`.
    const data = (created.data as Record<string, unknown> | undefined) ?? created;
    this.sessionId = stringField(data, 'id');
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
    
    // The 2.x prompt takes plain text; the model is a SESSION property, set at creation.
    const body: Record<string, unknown> = { text };

    let failure: unknown;
    try {
      const res = await this.http('POST', `/api/session/${this.sessionId}/prompt`, body);
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
    // Only fires if the bus was already dead; otherwise `session.execution.*` ends the turn.
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

  /**
   * Settle the turn when the event bus is gone — nothing else would ever say it finished, and a
   * run must not wait out its wall-clock timeout.
   *
   * Deliberately NOT a timer. 2.x answers `POST /prompt` as soon as the message is ENQUEUED
   * (unlike v1's long poll, which returned when the turn was over), so an idle timer armed at
   * that point fires during the model's first tool round-trip and cuts the turn between steps:
   * the run then ends with the text of a step it never received (verified live — a tool-using
   * turn reported an empty answer). The boundary is `session.execution.succeeded|failed|
   * interrupted`; the wall-clock deadline covers a server that goes silent with its bus open.
   */
  private armTurnGrace(): void {
    if (!this.turnInFlight || !this.turnPostSettled) return;
    if (!this.sseConnected || this.sseClosed) this.finishTurn();
  }

  private isDropWhileSessionLives(err: unknown): boolean {
    if (!(err instanceof OpencodeTransportError)) return false;
    if (!this.serverOpen || this.hasExited()) return false;
    return this.sseConnected && !this.sseClosed;
  }

  // ---- SSE stream ---------------------------------------------------------

  private async consumeEvents(): Promise<void> {
    if (!this.baseUrl) return;
    this.sseConnected = await openOpencodeEventStream(`${this.baseUrl}/api/event`, {
      headers: { authorization: this.authHeader },
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
    const data = (evt.data as Record<string, unknown> | undefined) ?? {};
    // Every session event names its session; anything about another one is not ours.
    const sid = stringField(data, 'sessionID');
    if (sid !== undefined && this.sessionId !== undefined && sid !== this.sessionId) return;

    switch (type) {
      // ---- text: deltas are keyed by the assistant message's text ordinal
      case 'session.text.delta': {
        const delta = stringField(data, 'delta');
        if (!delta) return;
        const key = `${stringField(data, 'assistantMessageID') ?? ''}:${numField(data, 'ordinal')}`;
        this.textCoalescer.append(key, delta);
        return;
      }
      case 'session.text.ended': {
        const key = `${stringField(data, 'assistantMessageID') ?? ''}:${numField(data, 'ordinal')}`;
        this.textCoalescer.complete(key, stringField(data, 'text') ?? '');
        return;
      }
      // ---- tools
      // The name is announced on `input.started`; `called` carries only id/input/executed.
      case 'session.tool.input.started': {
        const id = stringField(data, 'id');
        const name = stringField(data, 'name');
        if (id && name) this.toolNames.set(id, name);
        return;
      }
      case 'session.tool.called': {
        const id = stringField(data, 'id');
        if (!id) return;
        const name = stringField(data, 'name') ?? this.toolNames.get(id) ?? 'tool';
        if (this.toolsSeen.has(id)) return;
        this.toolsSeen.add(id);
        const input = data.input ?? {};
        this.toolCalls.push({ id, name, input });
        this.emit({ type: 'tool-call', id, tool: name, input });
        return;
      }
      case 'session.tool.success':
      case 'session.tool.failed':
      case 'session.tool.error': {
        const id = stringField(data, 'id');
        if (!id) return;
        const content = data.content;
        const text = Array.isArray(content)
          ? content.map((part) => stringField(part as Record<string, unknown>, 'text') ?? '').join('')
          : safeStringify(content ?? data.metadata ?? data);
        this.emit({ type: 'tool-result', toolCallId: id, result: text, isError: type !== 'session.tool.success' });
        return;
      }
      // ---- usage: `step.ended` carries the authoritative final counters
      case 'session.step.ended':
      case 'session.usage.updated': {
        // Usage only — `session.execution.succeeded|failed` is the turn boundary, and a
        // step can end mid-run (one per tool turn).
        this.absorbUsage(data);
        return;
      }
      // ---- turn boundaries
      case 'session.execution.succeeded':
        this.finishTurn(true);
        return;
      case 'session.execution.failed':
      case 'session.execution.interrupted': {
        const error = data.error as Record<string, unknown> | undefined;
        const message = error ? (stringField(error, 'message') ?? safeStringify(error)) : undefined;
        if (message && type === 'session.execution.failed') {
          this.emit({ type: 'error', message: `opencode v2: ${message}` });
        }
        this.finishTurn(true);
        return;
      }
      default:
        return;
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
    const res = await opencodeRequest(`${this.baseUrl}${path}`, { method, body, headers: { authorization: this.authHeader } });
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

/**
 * `{ model: { providerID, id } }` for the session-create body, or `{}` when the run named no
 * model (the server then uses the host's configured default). OpenCode spans providers, so a
 * bare id is refused upstream by `parseModelIdentity`; here a malformed value degrades to "no
 * model" rather than failing a run that would otherwise start.
 */
function modelField(model: string | undefined): Record<string, unknown> {
  if (!model) return {};
  let identity;
  try {
    identity = parseModelIdentity(model);
  } catch {
    return {};
  }
  if (!identity) return {};
  return { model: { providerID: identity.provider, id: identity.model } };
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
