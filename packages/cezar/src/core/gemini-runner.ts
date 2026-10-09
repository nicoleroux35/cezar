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
    if (dir === 'in') {
      const mapping = mapAcpFrame(frame, this.ui, geminiDialect);
      this.ui = mapping.state;

      for (const uiEvent of mapping.events) {
        this.emitUiEvent(uiEvent);
        this.handleUiEvent(uiEvent);
      }
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
    this.emitError('Failed to spawn Gemini CLI', err);
    this.resolveResult(this.buildResult('failed'));
  }

  private buildResult(outcome: 'success' | 'failed', note?: string): AgentRunResult {
    const usage = this.ui.sessionUsage ?? { input: 0, output: 0 };
    return {
      text: (this.ui as any).text ?? '',
      toolCalls: (this.ui as any).toolCalls ?? [],
      tokensUsed: usage.input + usage.output,
      sessionId: this.acpSessionId,
    };
  }

  private collectStderr(): string {
    const chunks: Buffer[] = [];
    this.child.stderr.on('data', (chunk) => chunks.push(chunk));
    return Buffer.concat(chunks).toString('utf8');
  }

  private emitUiEvent(event: UiEvent): void {
    // Emit v1 events for backward compatibility
    const v1Event = uiEventToV1(event);
    if (v1Event && this.onEvent) {
      this.onEvent(v1Event);
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

function uiEventToV1(event: UiEvent): AgentEvent | null {
  // Simplified v1 mapping - expand as needed
  switch ((event as any).type) {
    case 'message.delta':
      return { type: 'text', text: (event as any).delta } as any;
    case 'tool.started':
      return { type: 'tool-call', name: (event as any).name } as any;
    case 'turn.completed':
      return { type: 'done' } as any;
    default:
      return null;
  }
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
}

function mockGeminiPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return resolvePath(dirname(thisFile), '../../test/mock/gemini-mock.mjs');
}
