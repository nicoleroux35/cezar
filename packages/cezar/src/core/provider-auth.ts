import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { AGENT_MODELS_LOCKED_ENV } from './agent-model-policy.ts';
import { profileEnv } from './agent-profiles.ts';
import { resolveClaudeBin } from './claude-bin.ts';
import { quoteExecutable, withEnvPrefix } from './shell-env.ts';
import { probeJunieAuthentication } from './junie-auth-probe.ts';
import {
  antigravityFileDeclaresAuth,
  claudeFileDeclaresAuth,
  codexFileDeclaresAuth,
  geminiFileDeclaresAuth,
  geminiHome,
  providerConfigDir,
} from './provider-file-config.ts';

export const PROVIDER_IDS = ['claude', 'codex', 'opencode', 'cursor', 'pi', 'junie', 'copilot', 'kilo', 'gemini', 'antigravity', 'http'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type ProviderConnectionState =
  | 'connected'
  | 'disconnected'
  | 'not-installed'
  | 'unknown';

export interface ProviderStatus {
  provider: ProviderId;
  status: ProviderConnectionState;
  enabled?: boolean;
  hint?: string;
  authFailureId?: string;
  /** Which agent account this row describes (spec 2026-07-29-agent-profiles). Absent on the rows
   *  `status()` builds — that route answers for the discovered default only, and stays exactly
   *  as wide as it has always been. Stamped in by `profileStatus()`. */
  profileId?: string;
}

export interface ProviderStatusResponse {
  providers: ProviderStatus[];
}

export interface ProviderCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  errorCode?: string;
  timedOut?: boolean;
}

export type RunProviderCommand = (
  executable: string,
  args: readonly string[],
  timeoutMs: number,
  /** Extra environment for the probe — how an agent profile's config dir reaches the CLI (spec
   *  2026-07-29-agent-profiles). Optional so every existing caller and the test kit keep their
   *  three-argument signature; absent means the default profile, which needs nothing. */
  env?: Record<string, string>,
  /** Written to the probe's stdin, which is then closed. Only Copilot needs it: the CLI ships no
   *  non-interactive auth-status command, so its state is read by driving its ACP server. Optional
   *  so every existing caller and the test kit keep their shorter signature. */
  stdin?: string,
) => Promise<ProviderCommandResult>;

/**
 * The explicit environment lock delegates model and credential configuration
 * to each native coding agent. In that mode Cezar must not second-guess the
 * agent's own credentials through the provider checks introduced by #652.
 *
 * Config-file model locks intentionally do not disable the checks: this bypass
 * is an operator-level process policy and only the exact documented `1` opts in.
 */
export function providerAuthChecksDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[AGENT_MODELS_LOCKED_ENV] === '1';
}

interface ProviderDescriptor {
  id: ProviderId;
  executable: () => string;
  statusArgs: readonly string[];
  loginArgs: readonly string[];
  installHint: string;
  /**
   * An answer available WITHOUT spawning the CLI at all, checked before `runCommand` — `undefined`
   * defers to the installation probe. Covers API keys and custom endpoints in the environment and
   * the endpoint a provider switcher (cc-switch) writes into the agent's OWN config file
   * (`provider-file-config.ts`).
   */
  precheck?: (context: { configDir?: string | null }) => ProviderConnectionState | undefined;
}

const COMMAND_TIMEOUT_MS = 10_000;
/**
 * How long a probe result stands before it is re-checked — deliberately ASYMMETRIC.
 *
 * Which login an agent is signed into is operating knowledge: it matters for every run, and it
 * changes only when someone runs `claude auth login`. Re-probing it every few seconds cost a CLI
 * shell-out per provider and per account on every page load, for an answer that had almost
 * certainly not changed. So a CONNECTED answer is kept for minutes.
 *
 * A NOT-CONNECTED answer is re-checked sooner, for ONE reason: display self-healing. If you
 * install a CLI from a terminal, cezar cannot see it happen, so a card that says
 * "not-installed" must eventually find out on its own. The window is a minute rather than seconds because reading is now
 * stale-while-revalidate (see `status`): every expiry costs a background probe, and a cockpit
 * polling this endpoint would turn a five-second window into a spawn every five seconds, forever,
 * on any machine where one provider is logged out — which is most of them.
 *
 * What this window is NOT is a correctness mechanism for starting runs. `provider-action-gate.ts`
 * refuses to start a run against a provider it believes disconnected, and it re-verifies before it
 * refuses (`providerActionError` in `server.ts`) rather than trusting an aging negative. That
 * inversion is what makes a long window safe here: the only reader that must not be wrong pays for
 * its own certainty, on the rare path where it is about to say no.
 *
 * A stale CONNECTED answer needs no window at all: the run starts, and a credential that really has
 * gone bad surfaces as a runtime auth failure, which is latched and overrides this cache on the spot
 * (`withRuntimeFailures`).
 *
 * Anything cezar CAN observe invalidates explicitly instead of waiting for either window: opening a
 * login (`POST /providers/connect`), repointing or removing an account (`forgetProfileStatus`), and
 * a runtime rejection.
 */
const CONNECTED_TTL_MS = 10 * 60_000;
const UNSETTLED_TTL_MS = 60_000;

/**
 * How long before the same provider may be self-checked again after a runtime rejection
 * (`verifyRuntimeAuthFailure`).
 *
 * A latch is raised from a PATTERN MATCH on a runner's error text, and a single failing run can emit
 * several auth-shaped lines in a row. Without a floor, each line that re-latches after a successful
 * self-check would buy its own CLI spawn. One self-check a minute is plenty for the case this exists
 * for — a rejection that was transient against credentials that are still valid — and it bounds the
 * pathological case (a CLI that reports logged in while the vendor keeps rejecting the token) to one
 * probe per minute instead of one per error line.
 */
const RUNTIME_AUTH_VERIFY_COOLDOWN_MS = 60_000;

/** The lifetime for a set of rows: minutes only when EVERY row is connected. A mixed answer takes
 *  the short window, because the not-connected row in it is the one that might self-heal.
 *
 *  KNOWN COARSENESS: the window applies to the whole three-provider response, so one logged-out
 *  provider drags the two connected ones into re-probing with it. That is wasted work rather than a
 *  wrong answer, and it is now paid in the background; fixing it properly means per-provider
 *  timestamps and merging partial probe results. */
function cacheTtlFor(rows: readonly ProviderStatus[]): number {
  // Junie deliberately remains `unknown` after a successful handshake, so it must not force
  // every other provider's cached credential result onto the short negative-answer window.
  // HTTP is also excluded: it returns 'disconnected' when CEZ_HTTP_AGENT_CONFIG is unset,
  // which is the expected state for most users who don't use custom endpoints.
  return rows.filter((row) => row.provider !== 'junie' && row.provider !== 'http').every((row) => row.status === 'connected')
    ? CONNECTED_TTL_MS
    : UNSETTLED_TTL_MS;
}
const UNKNOWN_HINT = 'Authentication could not be verified. Try again.';
const RUNTIME_AUTH_HINT =
  'Authentication was rejected during a run. Reconnect, then try again.';
const RUNTIME_AUTH_FAILURE_PATTERNS = [
  /\b(?:failed to authenticate|authentication failed|unauthenticated|unauthorized)\b/i,
  /\bproviderautherror\b/i,
  /\b(?:oauth|access|refresh)?\s*token\b.{0,80}\b(?:revoked|expired|invalid)\b/i,
  /\b(?:revoked|expired|invalid)\b.{0,80}\b(?:oauth|access|refresh)?\s*token\b/i,
  /\b(?:oauth|token|credential|unauthorized|unauthenticated)\b.{0,80}\b401\b/i,
  /\b401\b.{0,80}\b(?:oauth|token|credential|unauthorized|unauthenticated)\b/i,
] as const;
const RUNTIME_API_KEY_FAILURE_PATTERNS = [
  // Vendor-shaped errors can carry a process prefix before the actual
  // authentication error, so anchor on that explicit error label.
  /\b(?:api|authentication|auth)\s*error\b\s*[:=-]\s*(?:(?:http\s+)?401\b[\s:=-]*)?(?:(?:revoked|expired|invalid)\s+(?:api[-\s]?key|x-api-key)|(?:api[-\s]?key|x-api-key)\s*(?:(?:is|was|has been)\s+|[:=-]\s*)?(?:revoked|expired|invalid))\b/i,
  // Otherwise require the credential rejection to be the complete line,
  // optionally introduced by a generic error label or 401 status. This keeps
  // implementation notes such as "coverage for invalid API key handling"
  // from looking like live authentication failures.
  /(?:^|\r?\n)\s*(?:error\s*[:=-]\s*)?(?:(?:http\s+)?401\b[\s:=-]*)?(?:(?:revoked|expired|invalid)\s+(?:api[-\s]?key|x-api-key)|(?:api[-\s]?key|x-api-key)\s+(?:(?:is|was|has been)\s+)?(?:revoked|expired|invalid))\s*(?:[.!]|$)/im,
] as const;

export function isRuntimeProviderAuthFailure(message: string): boolean {
  return [...RUNTIME_AUTH_FAILURE_PATTERNS, ...RUNTIME_API_KEY_FAILURE_PATTERNS]
    .some((pattern) => pattern.test(message));
}

const DESCRIPTORS: readonly ProviderDescriptor[] = [
  {
    id: 'claude',
    executable: () => resolveClaudeBin(),
    statusArgs: ['auth', 'status', '--json'],
    loginArgs: ['auth', 'login'],
    installHint: 'Install Claude Code, then run `claude auth login` (or set ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL).',
    // Claude Code can use ANTHROPIC_API_KEY directly, or custom endpoint via ANTHROPIC_BASE_URL
    // The same endpoint can also live in `~/.claude/settings.json`'s `env` block, which is where a
    // provider switcher such as cc-switch writes it instead of exporting anything.
    precheck: ({ configDir }) => {
      if (process.env.ANTHROPIC_API_KEY?.trim()) return 'connected';
      if (process.env.ANTHROPIC_AUTH_TOKEN?.trim()) return 'connected';
      if (process.env.ANTHROPIC_BASE_URL?.trim()) return 'connected';
      if (claudeFileDeclaresAuth(providerConfigDir('claude', configDir))) return 'connected';
      return undefined;
    },
  },
  {
    id: 'codex',
    executable: () => process.env.CEZ_CODEX_BIN ?? 'codex',
    statusArgs: ['login', 'status'],
    loginArgs: ['login'],
    installHint: 'Install the Codex CLI, then run `codex login` (or set OPENAI_API_KEY / OPENAI_BASE_URL).',
    // Codex can use OPENAI_API_KEY or AZURE_OPENAI_API_KEY, or a custom endpoint — in the
    // environment, or as a `[model_providers.<id>]` block in `~/.codex/config.toml`, which is where
    // cc-switch writes it. Such a provider has NO login: `codex login status` answers "Not logged
    // in" while the CLI runs fine, so the config file is the only place that knows.
    precheck: ({ configDir }) => {
      if (process.env.OPENAI_API_KEY?.trim()) return 'connected';
      if (process.env.AZURE_OPENAI_API_KEY?.trim()) return 'connected';
      if (process.env.OPENAI_BASE_URL?.trim()) return 'connected';
      if (process.env.AZURE_OPENAI_ENDPOINT?.trim()) return 'connected';
      if (codexFileDeclaresAuth(providerConfigDir('codex', configDir))) return 'connected';
      return undefined;
    },
  },
  {
    id: 'opencode',
    executable: () => process.env.CEZ_OPENCODE_BIN ?? 'opencode',
    statusArgs: ['auth', 'list'],
    loginArgs: ['auth', 'login'],
    installHint: 'Install OpenCode, then run `opencode auth login` (or set provider API keys / base URLs).',
    // OpenCode supports multiple provider API keys and custom endpoints
    precheck: () => {
      const keys = [
        'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY',
        'AZURE_OPENAI_API_KEY',
        'OPENROUTER_API_KEY',
        'GROQ_API_KEY',
        'MISTRAL_API_KEY',
        'GEMINI_API_KEY',
        'GOOGLE_GENERATIVE_AI_API_KEY',
        'DEEPSEEK_API_KEY',
        'XAI_API_KEY',
        'PERPLEXITY_API_KEY',
        'TOGETHER_API_KEY',
        'FIREWORKS_API_KEY',
      ];
      const endpoints = [
        'OPENAI_BASE_URL',
        'ANTHROPIC_BASE_URL',
        'AZURE_OPENAI_ENDPOINT',
        'OPENROUTER_BASE_URL',
        'GROQ_BASE_URL',
        'MISTRAL_BASE_URL',
      ];
      return keys.some((key) => process.env[key]?.trim()) || endpoints.some((ep) => process.env[ep]?.trim())
        ? 'connected'
        : undefined;
    },
  },
  {
    id: 'cursor',
    executable: () => process.env.CEZ_CURSOR_AGENT_BIN ?? 'agent',
    statusArgs: ['status', '--format', 'json'],
    loginArgs: ['login'],
    installHint:
      'Install the Cursor CLI (`curl https://cursor.com/install -fsS | bash`), then run `agent login` (or set CURSOR_API_KEY / CURSOR_BASE_URL).',
    // `agent status` doesn't itself know about CURSOR_API_KEY — see the `precheck` field's doc.
    precheck: () => {
      if (process.env.CURSOR_API_KEY?.trim()) return 'connected';
      if (process.env.CURSOR_BASE_URL?.trim()) return 'connected';
      return undefined;
    },
  },
  {
    id: 'pi',
    executable: () => process.env.CEZ_PI_BIN ?? 'pi',
    statusArgs: ['--list-models'],
    loginArgs: ['/login'],
    installHint: 'Install pi, then run `pi /login` (or set provider API keys / base URLs).',
    // Pi supports multiple provider API keys (same as OpenCode) and custom endpoints
    precheck: () => {
      const keys = [
        'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY',
        'AZURE_OPENAI_API_KEY',
        'OPENROUTER_API_KEY',
        'GROQ_API_KEY',
        'MISTRAL_API_KEY',
        'GEMINI_API_KEY',
        'GOOGLE_GENERATIVE_AI_API_KEY',
        'DEEPSEEK_API_KEY',
        'XAI_API_KEY',
        'PERPLEXITY_API_KEY',
        'TOGETHER_API_KEY',
        'FIREWORKS_API_KEY',
      ];
      const endpoints = [
        'OPENAI_BASE_URL',
        'ANTHROPIC_BASE_URL',
        'AZURE_OPENAI_ENDPOINT',
        'OPENROUTER_BASE_URL',
        'GROQ_BASE_URL',
        'MISTRAL_BASE_URL',
      ];
      return keys.some((key) => process.env[key]?.trim()) || endpoints.some((ep) => process.env[ep]?.trim())
        ? 'connected'
        : undefined;
    },
  },
  {
    id: 'junie',
    executable: () => process.env.CEZ_JUNIE_BIN ?? 'junie',
    statusArgs: [],
    loginArgs: [],
    installHint: 'Install Junie (https://junie.jetbrains.com/cli), then run `junie` once and log in.',
  },
  {
    id: 'copilot',
    executable: () => process.env.CEZ_COPILOT_BIN ?? 'copilot',
    statusArgs: ['--acp'],
    loginArgs: ['login'],
    installHint: 'Install GitHub Copilot CLI (`npm i -g @github/copilot`), then run `copilot login`.',
  },
  {
    id: 'kilo',
    executable: () => process.env.CEZ_KILO_BIN ?? 'kilo',
    statusArgs: ['auth', 'list'],
    loginArgs: ['auth', 'login'],
    installHint: 'Install Kilo Code (npm i -g @kilocode/cli or https://kilo.ai), then run `kilo auth login` (or set provider API keys / base URLs).',
    // Kilo supports multiple provider API keys (same as OpenCode) and custom endpoints
    precheck: () => {
      const keys = [
        'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY',
        'AZURE_OPENAI_API_KEY',
        'OPENROUTER_API_KEY',
        'GROQ_API_KEY',
        'MISTRAL_API_KEY',
        'GEMINI_API_KEY',
        'GOOGLE_GENERATIVE_AI_API_KEY',
        'DEEPSEEK_API_KEY',
        'XAI_API_KEY',
        'PERPLEXITY_API_KEY',
        'TOGETHER_API_KEY',
        'FIREWORKS_API_KEY',
      ];
      const endpoints = [
        'OPENAI_BASE_URL',
        'ANTHROPIC_BASE_URL',
        'AZURE_OPENAI_ENDPOINT',
        'OPENROUTER_BASE_URL',
        'GROQ_BASE_URL',
        'MISTRAL_BASE_URL',
      ];
      return keys.some((key) => process.env[key]?.trim()) || endpoints.some((ep) => process.env[ep]?.trim())
        ? 'connected'
        : undefined;
    },
  },
  {
    id: 'gemini',
    executable: () => process.env.CEZ_GEMINI_BIN ?? 'gemini',
    statusArgs: ['--version'],
    loginArgs: [],
    installHint: 'Install Gemini CLI (npm i -g @google/gemini-cli), then authenticate with your Google account or set GEMINI_API_KEY / GOOGLE_API_BASE_URL.',
    // Gemini's own CLI answers nothing about auth (`--version` prints a version; 0.61.0 has no
    // `auth status`), so without this the row stayed 'unknown' forever and the run gate blocked
    // Gemini entirely. Its stored OAuth login is the only signal that exists.
    precheck: () => {
      if (process.env.GEMINI_API_KEY?.trim()) return 'connected';
      if (process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) return 'connected';
      if (process.env.GOOGLE_API_BASE_URL?.trim()) return 'connected';
      if (geminiFileDeclaresAuth(geminiHome())) return 'connected';
      return undefined;
    },
  },
  {
    id: 'antigravity',
    executable: () => process.env.CEZ_ANTIGRAVITY_BIN ?? 'agy',
    statusArgs: ['--version'],
    loginArgs: [],
    installHint: 'Install Antigravity CLI, then run `agy` to sign in with your Google account (or set GOOGLE_GENERATIVE_AI_API_KEY / GOOGLE_API_BASE_URL).',
    // Same blind spot as Gemini: `agy --help` (1.3.0) has no auth-status subcommand either.
    precheck: () => {
      if (process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) return 'connected';
      if (process.env.GOOGLE_API_BASE_URL?.trim()) return 'connected';
      if (antigravityFileDeclaresAuth(geminiHome())) return 'connected';
      return undefined;
    },
  },
  {
    id: 'http',
    // No CLI exists for this backend, so there is nothing a login or a status probe could spawn.
    // `precheck` below always answers, which is what keeps this placeholder, `statusArgs` and
    // `loginArgs` unreachable — and `POST /providers/connect` refuses `http` outright (there is no
    // sign-in to open) instead of rendering a command from them. That refusal is the fix for a
    // real bug: `loginCommand('http')` used to render `'node'`, so pressing Connect opened a
    // terminal on a bare Node REPL that did nothing at all.
    executable: () => 'node',
    statusArgs: [],
    loginArgs: [],
    installHint: 'HTTP agent requires no installation. Configure it as an agent account (Settings → Agent accounts → HTTP Agent) or set CEZ_HTTP_AGENT_CONFIG with endpoint URL and optional API key.',
    // This backend's whole configuration is presence — and, for a stored account, the JSON itself.
    //
    // `CEZ_HTTP_AGENT_CONFIG` is the name `PROFILE_ENV_VAR.http` exports and the name
    // `http-agent-runner.ts` reads, so a value here means exactly what `profileEnv` hands a run:
    // the account's config dir. The two sources are tried in the same order for the same reason
    // `startSession` tries them — the account's own `configDir` first, the process env as the
    // zero-config fallback — so "is this account usable?" is answered by the very string the run
    // would be spawned with, with no second rule to drift from it.
    //
    // The account branch is load-bearing, not tidiness: a stored http account does NOT set the
    // process variable (only the spawned child gets it, via `profileEnv`), so a check that read
    // `process.env` alone would answer `disconnected` for every account that works — and the row
    // would offer a Connect button with nothing behind it.
    precheck: ({ configDir }) => {
      const config = configDir?.trim() || process.env.CEZ_HTTP_AGENT_CONFIG?.trim() || '';
      if (!config) return 'disconnected';
      try {
        const parsed = JSON.parse(config) as { endpoint?: string };
        return parsed.endpoint ? 'connected' : 'disconnected';
      } catch {
        return 'disconnected';
      }
    },
  },
];

function defaultRunProviderCommand(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
  env?: Record<string, string>,
  stdin?: string,
): Promise<ProviderCommandResult> {
  return new Promise((resolve) => {
    const child = execFile(
      executable,
      args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 256 * 1024,
        // Inherit, then override: an auth probe is a short read-only CLI call, not a spawned
        // agent, so it does not go through `buildChildEnv`'s allowlist — the CLI still needs the
        // host's PATH and HOME to run at all. `env` is only ever a profile's config-dir variable.
        ...(env && Object.keys(env).length > 0 ? { env: { ...process.env, ...env } } : {}),
      },
      (error, stdout, stderr) => {
        const commandError = error as (NodeJS.ErrnoException & {
          killed?: boolean;
          signal?: string | null;
        }) | null;
        const code = commandError?.code;
        resolve({
          stdout: String(stdout),
          stderr: String(stderr),
          exitCode: typeof code === 'number' ? code : error ? null : 0,
          errorCode: typeof code === 'string' ? code : undefined,
          timedOut: commandError?.code === 'ETIMEDOUT'
            || (commandError?.killed === true && commandError.signal === 'SIGTERM'),
        });
      },
    );
    // Closing stdin is what makes a stdin-driven probe terminate at all: the Copilot ACP server
    // reads until EOF. A probe with no payload closes it immediately, exactly as before.
    child.stdin?.end(stdin ?? '');
  });
}

/** The per-account cache key. ONE definition: a probe that wrote under a different spelling than
 *  a peek reads would silently make every peek a miss, and every page load pay for a CLI spawn. */
function profileCacheKey(provider: ProviderId, profileId: string): string {
  return `${provider}\u0000${profileId}`;
}

function descriptorFor(provider: ProviderId): ProviderDescriptor {
  const descriptor = DESCRIPTORS.find(({ id }) => id === provider);
  if (!descriptor) throw new Error(`Unknown provider: ${provider}`);
  return descriptor;
}

interface RuntimeAuthFailure {
  generation: number;
  authFailureId: string;
}

/** One authoritative runtime authentication incident. The identifier is opaque
 * and stable until the user explicitly acknowledges that exact incident. */
export interface RuntimeAuthFailureReport {
  status: ProviderStatus & {
    status: 'disconnected';
    authFailureId: string;
  };
  /** True only for the global latch edge, so callers can fan out one coarse
   * status update while every affected task still records its own callout. */
  transitioned: boolean;
}

export class ProviderAuthService {
  private readonly runCommand: RunProviderCommand;
  private readonly now: () => number;
  private readonly platform: NodeJS.Platform;
  private readonly createAuthFailureId: () => string;
  private readonly probeJunie: () => Promise<{ connected: boolean; hint?: string; notInstalled?: boolean }>;
  private readonly runtimeFailures = new Map<ProviderId, RuntimeAuthFailure>();
  /** One self-check at a time per provider, and not more often than the cooldown. Both guard the
   *  same thing — a CLI spawn per auth-shaped error line — from the two directions it can arrive
   *  from: concurrently, and in quick succession. */
  private readonly verifyingRuntimeFailures = new Set<ProviderId>();
  private readonly lastRuntimeVerification = new Map<ProviderId, number>();
  private nextRuntimeFailureGeneration = 0;
  private nextProbeGeneration = 0;
  private completed?: {
    response: ProviderStatusResponse;
    timestamp: number;
    generation: number;
  };
  private inFlight?: {
    raw: Promise<ProviderStatusResponse>;
    visible: Promise<ProviderStatusResponse>;
  };
  /** Per-account probe results, keyed by `profileCacheKey` (spec 2026-07-29-agent-profiles).
   *  Separate from `completed` because a second Claude login is a different answer to the same
   *  question, and sharing one slot would let whichever probe ran last speak for both. */
  private readonly completedProfiles = new Map<string, { status: ProviderStatus; timestamp: number }>();
  private readonly inFlightProfiles = new Map<string, Promise<ProviderStatus>>();

  constructor(options?: {
    runCommand?: RunProviderCommand;
    now?: () => number;
    platform?: NodeJS.Platform;
    createAuthFailureId?: () => string;
    /** Working directory the junie ACP probe opens its session in. Defaults to `process.cwd()`,
     *  but the server passes the boot project root so this agrees with the model catalog's own
     *  discovery cwd (`server.ts`'s `bootRoot`) instead of silently diverging from it. */
    cwd?: string;
    probeJunie?: () => Promise<{ connected: boolean; hint?: string; notInstalled?: boolean }>;
  }) {
    this.runCommand = options?.runCommand ?? defaultRunProviderCommand;
    this.now = options?.now ?? Date.now;
    this.platform = options?.platform ?? process.platform;
    this.createAuthFailureId = options?.createAuthFailureId ?? randomUUID;
    // Bounded to the SAME budget every other provider's status probe respects (#M2 review) — the
    // discovery module's own 15s default exists for the explicit "Check again" / model-picker
    // path, not for a status read that runs on every poll and warm-up.
    this.probeJunie = options?.probeJunie
      ?? (() => probeJunieAuthentication({ cwd: options?.cwd ?? process.cwd(), timeoutMs: COMMAND_TIMEOUT_MS }));
  }

  /**
   * Every provider's authentication state — STALE-WHILE-REVALIDATE, the same policy the health
   * snapshot uses.
   *
   * Once anything is known, a reader gets it immediately and an expired cache is refreshed BEHIND
   * the answer instead of in front of it. Awaiting the refresh is what made `GET
   * /providers/status` cost ~0.8s here (and ~3s on a slower box) every time the window lapsed:
   * the endpoint is read by the cockpit on a poll, so "occasionally slow" means "slow in the UI,
   * unpredictably". Only a genuinely cold cache waits, and after the boot warm there isn't one.
   *
   * `refresh: true` still blocks — it is what "Check again", `POST /providers/connect` and the
   * action gate's verify-before-refuse use, and they are asking precisely because they need an
   * answer that is true NOW.
   */
  status(options?: { refresh?: boolean }): Promise<ProviderStatusResponse> {
    if (process.env.CEZ_DRY_RUN === '1' || providerAuthChecksDisabled()) {
      return Promise.resolve({
        providers: PROVIDER_IDS.map((provider) => ({ provider, status: 'connected' })),
      });
    }

    if (options?.refresh) {
      // Joining a probe already running satisfies "true now" and preserves the in-flight identity
      // contract (one shared promise for concurrent callers).
      return this.inFlight ? this.inFlight.visible : this.startFreshProbe().visible;
    }
    if (this.completed) {
      // Checked BEFORE `inFlight` on purpose: a reader arriving during a background revalidation
      // must be served from cache, not attached to the probe it was meant to avoid.
      if (this.now() - this.completed.timestamp >= cacheTtlFor(this.completed.response.providers)) {
        if (!this.inFlight) void this.startFreshProbe().raw.catch(() => {});
      }
      return Promise.resolve(this.withRuntimeFailures(this.completed.response));
    }
    if (this.inFlight) return this.inFlight.visible;
    return this.startFreshProbe().visible;
  }

  reportRuntimeAuthFailure(provider: ProviderId): RuntimeAuthFailureReport | null {
    if (process.env.CEZ_DRY_RUN === '1' || providerAuthChecksDisabled()) return null;
    const current = this.runtimeFailures.get(provider);
    const failure: RuntimeAuthFailure = {
      generation: ++this.nextRuntimeFailureGeneration,
      authFailureId: current?.authFailureId ?? this.createAuthFailureId(),
    };
    this.runtimeFailures.set(provider, failure);
    return {
      status: {
        provider,
        status: 'disconnected',
        hint: RUNTIME_AUTH_HINT,
        authFailureId: failure.authFailureId,
      },
      transitioned: current === undefined,
    };
  }

  /** Clear only the incident the caller actually observed. A stale retry must
   * never erase a rejection that arrived after the user began recovery. */
  clearRuntimeAuthFailure(provider: ProviderId, authFailureId: string): boolean {
    const current = this.runtimeFailures.get(provider);
    if (!current || current.authFailureId !== authFailureId) return false;
    this.runtimeFailures.delete(provider);
    return true;
  }

  /**
   * Ask the provider's OWN CLI whether a runtime rejection was real, and drop the incident when it
   * was not. Resolves to the recovered row when it cleared one, `null` otherwise.
   *
   * A latch is raised by matching a runner's error text against
   * {@link isRuntimeProviderAuthFailure} — a heuristic over vendor prose — and it then outranks every
   * probe (`withRuntimeFailures`). Before this existed, `clearRuntimeAuthFailure` had exactly one
   * caller, `POST /providers/:provider/retry`, so the only way out of a latch was a human opening
   * Settings and pressing "Try again". That button clears the incident and re-probes, and it works,
   * which is the whole diagnosis: the credentials were still there. A transient 401 and a false
   * positive of the text match were both indistinguishable from a real logout, and both parked the
   * cockpit until someone clicked.
   *
   * So the latch stays authoritative — it is raised instantly, and `provider-action-gate` keeps
   * refusing to start runs against it — but it no longer stands unexamined. This is deliberately the
   * same two steps the retry route performs, minus the human: probe, then clear.
   *
   * What it will NOT do:
   * - clear an incident it did not observe. The id is captured before the probe and handed to
   *   `clearRuntimeAuthFailure`, so a rejection that arrives mid-probe survives the answer to an
   *   older question.
   * - clear on anything but `connected`. `disconnected`, `not-installed` and `unknown` all leave the
   *   latch alone; an inconclusive probe is not evidence of health.
   * - spawn more than one probe per provider per {@link RUNTIME_AUTH_VERIFY_COOLDOWN_MS}.
   */
  async verifyRuntimeAuthFailure(provider: ProviderId): Promise<ProviderStatus | null> {
    if (process.env.CEZ_DRY_RUN === '1' || providerAuthChecksDisabled()) return null;
    const failure = this.runtimeFailures.get(provider);
    if (!failure) return null;
    if (this.verifyingRuntimeFailures.has(provider)) return null;
    const lastVerifiedAt = this.lastRuntimeVerification.get(provider);
    if (lastVerifiedAt !== undefined && this.now() - lastVerifiedAt < RUNTIME_AUTH_VERIFY_COOLDOWN_MS) {
      return null;
    }

    this.verifyingRuntimeFailures.add(provider);
    let probed: ProviderStatus;
    try {
      this.lastRuntimeVerification.set(provider, this.now());
      probed = await this.probe(descriptorFor(provider));
    } finally {
      this.verifyingRuntimeFailures.delete(provider);
    }

    if (probed.status !== 'connected') return null;
    if (!this.clearRuntimeAuthFailure(provider, failure.authFailureId)) return null;
    this.rememberProbedRow(probed);
    return probed;
  }

  /**
   * Fold ONE freshly probed row into the cached response.
   *
   * Without this, dropping a latch would uncover whatever the last full probe happened to say about
   * that provider — which can be older than the answer we just got, and on a cold-ish cache can be
   * `unknown`. Clearing an incident only to reveal a stale contradiction would trade a red banner for
   * a grey one. The cache TIMESTAMP is deliberately untouched: this corrects one row, it is not a
   * full probe, and it must not extend the whole response's lifetime.
   */
  private rememberProbedRow(status: ProviderStatus): void {
    if (!this.completed) return;
    this.completed = {
      ...this.completed,
      response: {
        providers: this.completed.response.providers.map((row) => (
          row.provider === status.provider ? status : row
        )),
      },
    };
  }

  /**
   * The command that logs `provider` in, as a copyable one-liner.
   *
   * `configDir` points the login at a specific agent account (spec 2026-07-29-agent-profiles) —
   * without it, "Connect" on a second Claude account would sign the user into the FIRST one and
   * report success. Returns `null` when the dir cannot be embedded safely on this platform, and
   * the caller must then refuse rather than fall back to the bare command: a login aimed at the
   * wrong account is the failure this whole path exists to prevent.
   */
  loginCommand(provider: ProviderId, configDir?: string | null): string | null {
    const descriptor = descriptorFor(provider);
    const command = [quoteExecutable(descriptor.executable(), this.platform), ...descriptor.loginArgs].join(' ');
    const env = configDir ? profileEnv(provider, configDir) : {};
    return withEnvPrefix(command, env, this.platform);
  }

  installHint(provider: ProviderId): string {
    return descriptorFor(provider).installHint;
  }

  private withRuntimeFailures(response: ProviderStatusResponse): ProviderStatusResponse {
    if (this.runtimeFailures.size === 0) return response;
    return {
      providers: response.providers.map((row) => {
        const failure = this.runtimeFailures.get(row.provider);
        return failure
          ? {
            provider: row.provider,
            status: 'disconnected',
            hint: RUNTIME_AUTH_HINT,
            authFailureId: failure.authFailureId,
          }
          : row;
      }),
    };
  }

  private startFreshProbe(): {
    raw: Promise<ProviderStatusResponse>;
    visible: Promise<ProviderStatusResponse>;
  } {
    const generation = ++this.nextProbeGeneration;
    const raw = Promise.all(DESCRIPTORS.map((descriptor) => this.probe(descriptor)))
      .then((providers) => {
        const response = { providers };
        if (!this.completed || generation >= this.completed.generation) {
          this.completed = { response, timestamp: this.now(), generation };
        }
        return response;
      });
    // One derived visible promise per raw probe preserves the historical
    // in-flight identity contract while still consulting the current latch
    // only after the async vendor commands resolve.
    const probe = {
      raw,
      visible: raw.then((response) => this.withRuntimeFailures(response)),
    };
    this.inFlight = probe;
    void raw.finally(() => {
      if (this.inFlight === probe) this.inFlight = undefined;
    });
    return probe;
  }

  /**
   * One NON-default agent account's authentication state (spec 2026-07-29-agent-profiles).
   *
   * Deliberately a separate entry point from `status()`, which keeps answering exactly one row
   * per provider — the discovered default — so `GET /api/v1/providers/status` is byte-identical
   * for anyone with no extra accounts. Per-account rows are carried by the agent-profiles route.
   *
   * Cached on the same asymmetric lifetime as `status()` (`cacheTtlFor`: minutes for a connected
   * answer, a minute for anything else), keyed by `(provider, profileId)` so two Claude accounts never read
   * each other's answer. The runtime-auth latch is deliberately NOT applied: it is a coarse
   * per-provider signal and stamping it onto every account of that provider would mark an
   * untouched account as broken.
   */
  async profileStatus(
    provider: ProviderId,
    profile: { id: string; configDir: string | null },
  ): Promise<ProviderStatus> {
    if (process.env.CEZ_DRY_RUN === '1') {
      return { provider, status: 'connected', profileId: profile.id };
    }
    const key = profileCacheKey(provider, profile.id);
    const cached = this.completedProfiles.get(key);
    if (cached && this.now() - cached.timestamp < cacheTtlFor([cached.status])) return cached.status;
    const pending = this.inFlightProfiles.get(key);
    if (pending) return pending;
    const probe = this.probe(descriptorFor(provider), profile.configDir)
      .then((status) => {
        const stamped: ProviderStatus = { ...status, profileId: profile.id };
        this.completedProfiles.set(key, { status: stamped, timestamp: this.now() });
        return stamped;
      })
      .finally(() => {
        if (this.inFlightProfiles.get(key) === probe) this.inFlightProfiles.delete(key);
      });
    this.inFlightProfiles.set(key, probe);
    return probe;
  }

  /**
   * Drop a cached per-account answer — used when an account's dir changes under us.
   *
   * TARGETED by default, because this cache is warmed at boot and is meant to survive: clearing
   * every account because ONE was repointed would throw away knowledge that is still true and make
   * the other accounts re-probe. Called with no argument it clears everything, which is what a
   * shutdown or a whole-store reload wants.
   */
  forgetProfileStatus(provider?: ProviderId, profileId?: string): void {
    if (provider === undefined || profileId === undefined) {
      this.completedProfiles.clear();
      return;
    }
    this.completedProfiles.delete(profileCacheKey(provider, profileId));
  }

  /**
   * The cached answer for one account, or `undefined` when nothing is known yet — WITHOUT
   * spawning anything.
   *
   * Every probe shells out to an agent CLI, which costs hundreds of milliseconds per provider and
   * per account. A route whose real job is "what exists" must not pay that: `GET /api/v1/health`
   * already established this posture (it serves whatever the cache holds and never pays a `gh`
   * shell-out), and this is the same rule for auth.
   *
   * The peeks deliberately ignore the TTLs below — they answer with the last thing known, however
   * old. The short window exists to stop a stale NEGATIVE from blocking a run, and a peek blocks
   * nothing: it fills in a dot on a settings page that offers Connect and a re-check right beside
   * it. Applying the window here instead made the whole cache expire in five seconds on any machine
   * where a single provider is logged out — which is most of them, since few people are signed into
   * all three — and put the shell-out straight back on the page load this exists to protect.
   * Callers that need a guaranteed-fresh answer call {@link status} or pass `refresh`.
   */
  peekProfileStatus(provider: ProviderId, profileId: string): ProviderStatus | undefined {
    if (process.env.CEZ_DRY_RUN === '1') {
      return { provider, status: 'connected', profileId };
    }
    return this.completedProfiles.get(profileCacheKey(provider, profileId))?.status;
  }

  /** The cached default-profile rows, or `undefined` when the probe has never completed. Same
   *  no-spawn contract as {@link peekProfileStatus}. */
  peekStatus(): ProviderStatusResponse | undefined {
    if (process.env.CEZ_DRY_RUN === '1') {
      return { providers: PROVIDER_IDS.map((provider) => ({ provider, status: 'connected' })) };
    }
    if (!this.completed) return undefined;
    return this.withRuntimeFailures(this.completed.response);
  }

  /**
   * Installation check, not an authentication check: a CLI that spawns at all counts as
   * `connected`. External credential managers (cc-switch and the like) configure endpoints the
   * vendor's own `login status` cannot see, so trusting its answer blocked working setups.
   * Only a missing binary (`ENOENT`) is `not-installed`; a real credential failure still
   * surfaces at runtime through the auth-failure latch, which outranks this probe.
   */
  private async probe(descriptor: ProviderDescriptor, configDir?: string | null): Promise<ProviderStatus> {
    if (descriptor.id === 'junie') {
      try {
        const result = await this.probeJunie();
        if (result.notInstalled) return { provider: 'junie', status: 'not-installed', hint: descriptor.installHint };
        return { provider: 'junie', status: 'connected' };
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
          return { provider: 'junie', status: 'not-installed', hint: descriptor.installHint };
        }
        return { provider: 'junie', status: 'connected' };
      }
    }
    const precheck = descriptor.precheck?.({ configDir });
    if (precheck !== undefined) return { provider: descriptor.id, status: precheck };
    let result: ProviderCommandResult;
    // The default profile is probed with the SAME three-argument call it always was — no
    // trailing `undefined`. `runCommand` is an injected seam, and handing every existing
    // implementation an extra argument it never asked for would be a change in the zero-config
    // path for no gain.
    const env = configDir ? profileEnv(descriptor.id, configDir) : undefined;
    try {
      const executable = descriptor.executable();
      result = await (env === undefined
        ? this.runCommand(executable, descriptor.statusArgs, COMMAND_TIMEOUT_MS)
        : this.runCommand(executable, descriptor.statusArgs, COMMAND_TIMEOUT_MS, env));
    } catch {
      return { provider: descriptor.id, status: 'unknown', hint: UNKNOWN_HINT };
    }
    if (result.errorCode === 'ENOENT') {
      return { provider: descriptor.id, status: 'not-installed', hint: descriptor.installHint };
    }
    // Anything else means the binary exists and ran: installed counts as connected. Its exit
    // code and output describe the vendor login, which an external credential manager bypasses.
    return { provider: descriptor.id, status: 'connected' };
  }
}
