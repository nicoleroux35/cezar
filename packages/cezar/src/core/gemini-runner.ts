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
  type AgentToolCallRecord,
  type ContentBlock,
  type SessionOptions,
} from './agent-runner.ts';
import { buildChildEnv } from './agent-env.ts';
import { AcpClient, type AcpContentBlock, type AcpMessage, type AcpRequestAnswer } from './acp-client.ts';
import { abortAcpTurn, endAcpReplay, mapAcpFrame, type AcpUiMapperState } from './acp-ui-mapper.ts';
import { EOF_KILL_GRACE_MS, EOF_TERM_GRACE_MS } from './claude-cli-runner.ts';
import {
  GEMINI_AUTH_FAILURE_MESSAGE,
  geminiDialect,
  createGeminiUiState,
  isGeminiAuthFailure,
} from './gemini-ui-mapper.ts';
import type { UiEvent } from './ui-events.ts';

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
/** `initialize` / `session/new` / `session/load` are handshakes: bounded, unlike a prompt. */
const HANDSHAKE_TIMEOUT_MS = 90_000;
/**
 * How long to wait for the end of a `session/load` replay (`available_commands_update`) before
 * prompting anyway. Gemini replays a loaded session's full history as `session/update` frames,
 * ending with `available_commands_update` marker (see `__fixtures__/gemini/load-replay.ndjson`).
 */
const REPLAY_WAIT_MS = 5_000;
const AUTO_END_DELAY_MS = 250;

export interface GeminiRunnerOptions {
  /** Override the binary; defaults to `gemini` on PATH (`CEZ_GEMINI_BIN`). */
  bin?: string;
  /** Wall-clock timeout for a run (ms); per-spec `timeoutMs` still wins. */
  timeoutMs?: number;
}

/**
 * Google Gemini CLI over the Agent Client Protocol (spec
 * `2026-09-19-runner-seam-native-backends` Phase 3): one long-lived `gemini --acp` child and one
 * ACP session per cezar session. Follow-ups are further `session/prompt` calls on the same
 * process; Continue resumes with `session/load`.
 *
 * The wire was verified against `@google/gemini-cli` 0.60.0 — fixtures are in
 * `__fixtures__/gemini/`. Permissions are `auto` only: the child starts with auto-approval,
 * and any `session/request_permission` that still arrives is auto-approved with a note.
 *
 * Exit codes (from gemini-cli source):
 * - 41: Authentication failure
 * - 52: Session not found (load failure)
 * - 55: Invalid session state
 */
export class GeminiRunner implements AgentRunner {
  readonly backend = 'gemini' as any;
  private readonly bin: string;
  private readonly timeoutMs: number;
  private lastSession: AgentSession | null = null;

  constructor(opts: GeminiRunnerOptions = {}) {
    this.bin =
      opts.bin ?? process.env.CEZ_GEMINI_BIN ?? (process.env.CEZ_DRY_RUN === '1' ? mockGeminiPath() : 'gemini');
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  run(spec: AgentRunSpec, onEvent?: (event: AgentEvent) => void): Promise<AgentRunResult> {
    return this.startSession(spec, onEvent, { autoEndAfterFirstTurn: true }).result;
  }

  async interrupt(): Promise<void> {
    this.lastSession?.interrupt();
  }

  startSession(spec: AgentRunSpec, onEvent?: (event: AgentEvent) => void, opts: SessionOptions = {}): AgentSession {
    const session = new GeminiAcpSession(this.bin, this.backend as any, spec, spec.timeoutMs ?? this.timeoutMs, onEvent, opts);
    this.lastSession = session;
    return session;
  }
}

/**
 * The CLI flags for one run. From `gemini --help`:
 *
 * - `--acp` starts the ACP server on stdio
 * - `--no-auto-update` prevents mid-task version swaps
 * - `--model` for model selection (optional)
 *
 * `spec.allowedTools` / `spec.bashAllowlist` are NOT translated — Gemini uses auto-approval mode.
 */
export function buildGeminiArgs(spec: Pick<AgentRunSpec, 'model'>): string[] {
  const args = ['--acp', '--no-auto-update'];
  if (spec.model) args.push('--model', spec.model);
  return args;
}

/** The per-run environment: `buildChildEnv`'s least-privilege set for this backend. */
export function buildGeminiEnv(backend: AgentBackend, extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  return buildChildEnv({ backend, extraEnv });
}

/**
 * A cezar-authored line for an exit outside a prompt.
 *
 * Gemini's documented exit codes:
 * - 41: Authentication failure
 * - 52: Session not found
 * - 55: Invalid session state
 */
export function geminiExitMessage(exitCode: number | null, stderr: string): string {
  if (isGeminiAuthFailure(stderr)) return GEMINI_AUTH_FAILURE_MESSAGE;
  
  const knownCodes: Record<number, string> = {
    41: 'Authentication failed — run `gemini` to authenticate',
    52: 'Session not found — the saved session may have expired',
    55: 'Invalid session state — try starting a new task',
  };
  
  if (exitCode !== null && knownCodes[exitCode]) {
    return knownCodes[exitCode];
  }
  
  const detail = stderr.trim().split('\n').slice(-3).join(' | ');
  return `Gemini CLI exited with code ${exitCode}${detail ? ` — ${truncate(detail, 400)}` : ''}`;
}

class GeminiAcpSession implements AgentSession {
  readonly result: Promise<AgentRunResult>;
  readonly pid?: number;

  private readonly child: ChildProcessWithoutNullStreams;
  private readonly client: AcpClient;
  private readonly hasExited: () => boolean;
  private ui: AcpUiMapperState = createGeminiUiState();
  private acpSessionId: string | undefined;
  private loadSupported = false;
  private imagesSupported = false;

  private isOpen = true;
  private turnInFlight = false;
  private turnsCompleted = 0;
  private readonly queue: AcpContentBlock[][] = [];
  private terminatedByCezar = false;
  private timedOut = false;
  private runTimeoutTimer: NodeJS.Timeout | null = null;

  // The v1 projection's own accumulation, kept here (not read back out of the mapper state):
  // `AcpUiMapperState` carries no `text`/`toolCalls` fields, so `buildResult` reading them — as
  // it used to, through `(this.ui as any)` — always produced an empty result.
  private readonly textChunks: string[] = [];
  private readonly toolCalls: AgentToolCallRecord[] = [];
  private tokensUsed = 0;

  private resolveResult!: (result: AgentRunResult) => void;
  private rejectResult!: (error: Error) => void;

  constructor(
    bin: string,
    backend: AgentBackend,
    private readonly spec: AgentRunSpec,
    timeoutMs: number,
    private readonly onEvent?: (event: AgentEvent) => void,
    private readonly opts: SessionOptions = {},
  ) {
    const args = buildGeminiArgs(spec);
    const env = buildGeminiEnv(backend, spec.env);

    this.child = nodeSpawn(bin, args, { cwd: spec.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.pid = this.child.pid;

    this.hasExited = trackChildExit(this.child);

    this.client = new AcpClient(this.child.stdin, this.child.stdout, {
      onFrame: (dir, frame) => this.onFrame(dir, frame),
      onRequest: (request) => this.onRequest(request),
    });

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

    // Handle process exit
    this.child.on('exit', (exitCode: number | null, signalCode: NodeJS.Signals | null) => {
      this.handleExit(exitCode, signalCode);
    });
    this.child.on('error', (err: Error) => {
      this.handleSpawnError(err);
    });

    // Start ACP client read loop
    this.client.run().catch((err) => {
      this.emitError('ACP client failed', err);
    });

    this.bootstrap().catch((err) => {
      this.emitError('Bootstrap failed', err);
      this.end();
    });
  }

  private onFrame(dir: 'in' | 'out', frame: AcpMessage): void {
    // BOTH directions: `mapAcpFrame` learns the turn from cezar's OUTBOUND `session/prompt` (it sets
    // `turnId` there) and drops every inbound `session/update` until it has. Minding only `dir ===
    // 'in'` — as this used to — left `turnId` unset, so the mapper rendered nothing and a gemini run
    // came back empty. `mapAcpFrame` also needs the `{ dir, frame }` wrapper, not the bare message.
    const mapping = mapAcpFrame({ dir, frame }, this.ui, geminiDialect);
    this.ui = mapping.state;

    for (const uiEvent of mapping.events) {
      this.emitUiEvent(uiEvent);
      this.handleUiEvent(uiEvent);
    }
  }

  private onRequest(request: AcpMessage): AcpRequestAnswer {
    // Auto-approve all permissions
    return { result: { approved: true } };
  }

  get open(): boolean {
    return this.isOpen;
  }

  sendMessage(content: ContentBlock[]): boolean {
    if (!this.isOpen || this.hasExited()) return false;

    const blocks = toAcpBlocks(content);
    
    if (this.turnInFlight) {
      this.queue.push(blocks);
      return true;
    }

    this.startTurn(blocks);
    return true;
  }

  end(): void {
    if (!this.isOpen) return;
    this.terminatedByCezar = true;
    
    if (this.runTimeoutTimer) {
      clearTimeout(this.runTimeoutTimer);
      this.runTimeoutTimer = null;
    }

    // A child that never started — spawn failed, so it has no pid — will never emit `exit`,
    // so the SIGTERM→SIGKILL watchdog below would sit on its 8s+4s timers with nothing to
    // clear them, keeping the process alive long after `end()` returned. There is also no
    // stdin to close and no process to signal. `handleSpawnError` owns the resolution.
    if (this.child.pid === undefined) {
      this.isOpen = false;
      return;
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

    // A child that never started — spawn failed, so it has no pid — has no process to signal,
    // and `kill()` on a spawn-failed handle that already has a queued stdin write blocks the
    // event loop synchronously, taking the run-timeout timer and the whole process with it.
    // There is nothing to interrupt; `handleSpawnError` owns the resolution.
    if (this.child.pid === undefined) {
      this.isOpen = false;
      return;
    }

    this.child.kill('SIGTERM');
  }

  private async bootstrap(): Promise<void> {
    // Initialize ACP connection
    await this.client.initialize(HANDSHAKE_TIMEOUT_MS);

    // Start or load session
    if (this.spec.sessionId) {
      await this.loadSession();
    } else {
      await this.newSession();
    }

    // Send first prompt if not auto-end
    if (!this.opts.autoEndAfterFirstTurn || this.spec.userPrompt) {
      const systemPrompt = prependSystemPrompt(this.spec.systemPrompt, this.spec.userPrompt);
      const content = toAcpBlocks([
        ...(systemPrompt ? [{ type: 'text' as const, text: systemPrompt }] : []),
        { type: 'text' as const, text: this.spec.userPrompt },
        ...(this.spec.images ?? []),
      ]);

      this.startTurn(content);
    }
  }

  private async newSession(): Promise<void> {
    const result = await this.client.newSession(this.spec.cwd, HANDSHAKE_TIMEOUT_MS);
    this.acpSessionId = typeof result.sessionId === 'string' ? result.sessionId : undefined;
    this.loadSupported = true;
    this.imagesSupported = true;
  }

  private async loadSession(): Promise<void> {
    if (!this.spec.sessionId) return;

    try {
      await this.client.loadSession(this.spec.sessionId, this.spec.cwd, HANDSHAKE_TIMEOUT_MS);

      this.acpSessionId = this.spec.sessionId;
      this.loadSupported = true;

      // Wait for replay to complete
      await this.waitForReplayEnd();
    } catch (err) {
      // Load failed, start new session
      await this.newSession();
    }
  }

  private async waitForReplayEnd(): Promise<void> {
    if (!this.ui.replaying) return;
    
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.ui = endAcpReplay(this.ui);
        resolve();
      }, REPLAY_WAIT_MS);
      
      const checkReplay = () => {
        if (!this.ui.replaying) {
          clearTimeout(timer);
          resolve();
        } else {
          setTimeout(checkReplay, 100);
        }
      };
      
      checkReplay();
    });
  }

  private startTurn(content: AcpContentBlock[]): void {
    if (!this.acpSessionId) {
      this.emitError('Gemini ACP session is not ready');
      this.end();
      return;
    }

    this.turnInFlight = true;
    const sessionId = this.acpSessionId;

    this.client.prompt(sessionId, content).then(
      () => {
        this.turnInFlight = false;
        this.turnsCompleted++;

        // Auto-end after first turn if requested
        if (this.opts.autoEndAfterFirstTurn && this.turnsCompleted === 1) {
          setTimeout(() => this.end(), AUTO_END_DELAY_MS);
        }

        // Process queued messages
        if (this.queue.length > 0 && !this.hasExited()) {
          const next = this.queue.shift()!;
          this.startTurn(next);
        }
      },
      (err: unknown) => {
        this.turnInFlight = false;
        this.emitError('Prompt failed', err);
        this.end();
      },
    );
  }

  private handleUiEvent(event: UiEvent): void {
    // Permission requests are handled by onRequest callback
    // No need to manually answer here
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
      const message = geminiExitMessage(exitCode, stderr);
      this.emitError(message);
      this.resolveResult(this.buildResult('failed'));
      return;
    }

    this.resolveResult(this.buildResult('success'));
  }

  private handleSpawnError(err: Error): void {
    this.isOpen = false;
    // A missing `gemini` binary emits `error` and never `exit`, so `handleExit` (which owns the
    // timer cleanup) never runs — leaving the run-timeout timer armed for its full wall clock and
    // the process alive with it. Release it here, the way `end()`/`interrupt()` do.
    if (this.runTimeoutTimer) {
      clearTimeout(this.runTimeoutTimer);
      this.runTimeoutTimer = null;
    }
    this.emitError('Failed to spawn Gemini CLI', err);
    this.resolveResult(this.buildResult('failed'));
  }

  private buildResult(outcome: 'success' | 'failed', note?: string): AgentRunResult {
    return {
      text: this.textChunks.join('').trim(),
      toolCalls: this.toolCalls,
      tokensUsed: this.tokensUsed,
      sessionId: this.acpSessionId,
    };
  }

  private collectStderr(): string {
    const chunks: Buffer[] = [];
    this.child.stderr.on('data', (chunk) => chunks.push(chunk));
    return Buffer.concat(chunks).toString('utf8');
  }

  /**
   * v1 derived from v2 (AGENT_PROTOCOL.md §2: every v1 event stays derivable from the v2 stream).
   * The ACP mapper speaks the item-lifecycle vocabulary — `item.delta` / `item.started` /
   * `item.completed` / `usage.updated` / `image` / `session.error` — so this switches on THOSE
   * names. (It previously checked v1-style names like `message.delta` and `tool.started`, which no
   * `UiEvent` carries, so every event fell through and a gemini run emitted no v1 events at all.)
   */
  private emitUiEvent(event: UiEvent): void {
    if (!this.onEvent) return;
    switch (event.type) {
      case 'item.delta':
        if (event.field === 'text') {
          this.textChunks.push(event.delta);
          this.onEvent({ type: 'text', text: event.delta });
        }
        return;
      case 'item.started':
        if (event.item.kind === 'tool') {
          const input = event.item.input ?? { title: event.item.title };
          this.toolCalls.push({ id: event.item.id, name: event.item.name, input });
          this.onEvent({ type: 'tool-call', id: event.item.id, tool: event.item.name, input });
        }
        return;
      case 'item.completed':
        if (event.item.kind === 'tool') {
          const failed = event.item.status === 'failed' || event.item.status === 'declined';
          this.onEvent({
            type: 'tool-result',
            toolCallId: event.item.id,
            result: (failed ? event.item.error : event.item.output) ?? '',
            isError: failed,
          });
        }
        return;
      case 'image':
        this.onEvent({ type: 'image', mediaType: event.mediaType, data: event.data });
        return;
      case 'usage.updated':
        this.tokensUsed = event.usage.total;
        this.onEvent({ type: 'token-usage', tokensUsed: this.tokensUsed });
        return;
      default:
        return;
    }
  }

  private emitError(message: string, err?: unknown): void {
    const event: AgentEvent = {
      type: 'error',
      message: err instanceof Error ? `${message}: ${err.message}` : message,
    };
    this.onEvent?.(event);
  }
}

function toAcpBlocks(content: ContentBlock[]): AcpContentBlock[] {
  return content.map((block) => {
    if (block.type === 'text') {
      return { type: 'text', text: block.text };
    } else if (block.type === 'image') {
      return {
        type: 'image',
        source: { type: 'base64', media_type: block.source.media_type, data: block.source.data },
      };
    }
    return { type: 'text', text: '' };
  }) as any;
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
}

function mockGeminiPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return resolvePath(dirname(thisFile), '../../test/mock/gemini-mock.mjs');
}
