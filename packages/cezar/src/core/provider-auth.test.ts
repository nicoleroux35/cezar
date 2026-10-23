import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Claude's executable is resolved by `resolveClaudeBin`, which probes PATH and then the
 * installers' known locations — so on a developer machine it answers with an absolute path like
 * `/Users/me/.local/bin/claude`. This suite asserts the executable LITERALLY (and `resultFor`
 * below routes anything it does not recognise to the pi fixture), so the real resolver would
 * make the whole file pass or fail depending on where claude happens to be installed on the host
 * running it — failing on precisely the off-PATH installs that resolver was added to support.
 *
 * Pin it to the environment override and the bare name: that is what these tests are about, and
 * `resolveClaudeBin` has its own dedicated coverage in `claude-bin.test.ts`.
 */
vi.mock('./claude-bin.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./claude-bin.ts')>(),
  resolveClaudeBin: (env: NodeJS.ProcessEnv = process.env) => env.CEZ_CLAUDE_BIN || 'claude',
}));
// Same reason for Cursor: `cursor-bin.test.ts` covers the real PATH resolution.
vi.mock('./cursor-bin.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./cursor-bin.ts')>(),
  resolveCursorAgentBin: () => process.env.CEZ_CURSOR_AGENT_BIN || 'agent',
}));
vi.mock('./junie-auth-probe.ts', () => ({
  probeJunieAuthentication: vi.fn(async () => ({ connected: true })),
}));

import { PROVIDER_IDS } from './provider-auth.ts';
import {
  ProviderAuthService,
  cliVersionFrom,
  copilotAcpAnswered,
  defaultRunProviderCommand,
  isDefinitiveProviderAuthFailure,
  isRuntimeProviderAuthFailure,
  providerAuthChecksDisabled,
  versionManagerShimMiss,
  type ProviderCommandResult,
  type RunProviderCommand,
} from './provider-auth.ts';
import { probeJunieAuthentication } from './junie-auth-probe.ts';

const connectedResults: Record<string, ProviderCommandResult> = {
  claude: { stdout: '{"loggedIn":true}', stderr: '', exitCode: 0 },
  codex: { stdout: 'Logged in using ChatGPT', stderr: '', exitCode: 0 },
  opencode: {
    stdout: [
      '┌  Credentials ~/.local/share/opencode/auth.json',
      '│',
      '●  Anthropic oauth',
      '│',
      '└  1 credential',
    ].join('\n'),
    stderr: '',
    exitCode: 0,
  },
  cursor: {
    stdout: JSON.stringify({
      status: 'authenticated',
      isAuthenticated: true,
      userInfo: { email: 'me@example.com' },
    }),
    stderr: '',
    exitCode: 0,
  },
  pi: {
    stdout: 'provider  model  context  max-out  thinking  images\nanthropic  claude  200K  64K  yes  yes',
    stderr: '',
    exitCode: 0,
  },
  // Copilot's probe drives its ACP server; a `sessionId` back means the credential is entitled
  // (`.ai/runs/2026-09-27-copilot-cli-runner/copilot-acp-notes.md`).
  copilot: {
    stdout: '{"jsonrpc":"2.0","id":1,"result":{"sessionId":"3f1b6f2e-0000-4000-8000-1f2e3d4c5b6a"}}',
    stderr: '',
    exitCode: 0,
  },
  kilo: {
    stdout: [
      '┌  Credentials ~/.local/share/kilo/auth.json',
      '│',
      '●  Anthropic oauth',
      '│',
      '└  1 credential',
    ].join('\n'),
    stderr: '',
    exitCode: 0,
  },
  gemini: {
    stdout: 'Status: authenticated',
    stderr: '',
    exitCode: 0,
  },
  antigravity: {
    stdout: 'Status: authenticated',
    stderr: '',
    exitCode: 0,
  },
  http: {
    stdout: '',
    stderr: '',
    exitCode: 0,
  },
};

const originalEnv = {
  CEZ_AGENT_MODELS_LOCKED: process.env.CEZ_AGENT_MODELS_LOCKED,
  CEZ_DRY_RUN: process.env.CEZ_DRY_RUN,
  CEZ_CLAUDE_BIN: process.env.CEZ_CLAUDE_BIN,
  CEZ_CODEX_BIN: process.env.CEZ_CODEX_BIN,
  CEZ_OPENCODE_BIN: process.env.CEZ_OPENCODE_BIN,
  CEZ_PI_BIN: process.env.CEZ_PI_BIN,
  CURSOR_API_KEY: process.env.CURSOR_API_KEY,
  CEZ_COPILOT_BIN: process.env.CEZ_COPILOT_BIN,
  CEZ_HTTP_AGENT_CONFIG: process.env.CEZ_HTTP_AGENT_CONFIG,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
  CURSOR_BASE_URL: process.env.CURSOR_BASE_URL,
  GOOGLE_API_BASE_URL: process.env.GOOGLE_API_BASE_URL,
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
  GROQ_BASE_URL: process.env.GROQ_BASE_URL,
  MISTRAL_BASE_URL: process.env.MISTRAL_BASE_URL,
  CEZ_CURSOR_AGENT_BIN: process.env.CEZ_CURSOR_AGENT_BIN,
};

beforeEach(() => {
  delete process.env.CEZ_AGENT_MODELS_LOCKED;
  delete process.env.CEZ_DRY_RUN;
  delete process.env.CEZ_CLAUDE_BIN;
  delete process.env.CEZ_CODEX_BIN;
  delete process.env.CEZ_OPENCODE_BIN;
  delete process.env.CEZ_PI_BIN;
  delete process.env.CURSOR_API_KEY;
  delete process.env.CEZ_COPILOT_BIN;
  delete process.env.CEZ_HTTP_AGENT_CONFIG;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.AZURE_OPENAI_ENDPOINT;
  delete process.env.CURSOR_BASE_URL;
  delete process.env.GOOGLE_API_BASE_URL;
  delete process.env.OPENROUTER_BASE_URL;
  delete process.env.GROQ_BASE_URL;
  delete process.env.MISTRAL_BASE_URL;
  delete process.env.CEZ_CURSOR_AGENT_BIN;
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** One status command per provider — the size of a full probe round. Derived rather than
 *  written out so adding runner #6 does not mean editing a dozen literal counts in this file.
 *  Junie is the exception: `probe()` routes it through `probeJunieAuthentication`, never
 *  `runCommand`, so it is a status row but not a status command. HTTP also has a precheck
 *  that returns before calling runCommand. */
const PROBE_ROUND = PROVIDER_IDS.filter((provider) => provider !== 'junie' && provider !== 'http').length;

function resultFor(executable: string): ProviderCommandResult {
  if (executable === 'claude') return connectedResults.claude!;
  if (executable.includes('codex')) return connectedResults.codex!;
  if (executable === 'agent' || executable.includes('cursor')) return connectedResults.cursor!;
  if (executable.includes('opencode')) return connectedResults.opencode!;
  if (executable.includes('copilot')) return connectedResults.copilot!;
  if (executable.includes('kilo')) return connectedResults.kilo!;
  if (executable.includes('gemini')) return connectedResults.gemini!;
  if (executable === 'agy' || executable.includes('antigravity')) return connectedResults.antigravity!;
  if (executable === 'node') return connectedResults.http!;
  return connectedResults.pi!;
}

function runner(
  resolve: (executable: string, args: readonly string[]) => ProviderCommandResult = resultFor,
): RunProviderCommand {
  return vi.fn(async (executable, args) => resolve(executable, args));
}

function statuses(
  service: ProviderAuthService,
): Promise<Record<string, { status: string; hint?: string }>> {
  return service.status().then(({ providers }) => Object.fromEntries(
    providers.map(({ provider, status, hint }) => [provider, { status, hint }]),
  ));
}

describe('runtime provider authentication failures', () => {
  it.each([
    'claude CLI exited with code 1 — Failed to authenticate. API Error: 401 OAuth access token has been revoked.',
    'codex: turn failed: unauthorized',
    'ProviderAuthError: API key expired — run `opencode auth login`',
    'API Error: invalid API key',
    'AuthenticationError: expired api-key',
    '401 invalid x-api-key',
    'x-api-key is invalid',
    'expired API key',
    'API key expired',
    'access token is invalid',
    'authentication failed with HTTP 401',
  ])('recognizes an authoritative runtime auth rejection: %s', (message) => {
    expect(isRuntimeProviderAuthFailure(message)).toBe(true);
  });

  it.each([
    'claude CLI exited with code 1 — TypeScript check failed',
    'API Error: 429 rate limit exceeded',
    'the agent fixed a 401 response in src/auth.ts',
    'added coverage for invalid API key handling',
    'fixed a 401 response in the API key header parser',
    'investigated expired API-key validation before updating the note-event tests',
    'the API key rotation guide is invalid because its example is stale',
    'the invalid response parser documents an API key header',
    'network connection reset',
  ])('does not turn unrelated failures into credential failures: %s', (message) => {
    expect(isRuntimeProviderAuthFailure(message)).toBe(false);
  });

  // Only a verdict a local status probe cannot contradict is definitive (telemetry 9e4a95db).
  it.each([
    ['claude: Failed to authenticate: OAuth session expired and could not be refreshed', true],
    ['OAuth refresh token is no longer valid; run /login to re-authenticate', true],
    ['Failed to authenticate. API Error: 401 OAuth access token has been revoked.', false],
    ['Failed to refresh OAuth token: another Claude Code process is refreshing it or exited mid-refresh.', false],
    ['OAuth access token could not be refreshed: another Claude Code process is holding the refresh lock', false],
  ])('classifies %s as definitive: %s', (message, definitive) => {
    expect(isDefinitiveProviderAuthFailure(message)).toBe(definitive);
  });
});

describe('provider installation probe', () => {
  // Upstream's probe is an AUTHENTICATION check: each CLI's own status answer is parsed, and an
  // unreadable answer stays `unknown` rather than being guessed. The fork's four extra backends
  // keep an INSTALLATION check where the vendor exposes no auth-status subcommand at all
  // (kilo speaks OpenCode's `auth list`; gemini/antigravity only print a version; http has no CLI).
  // External credential managers (cc-switch and the like) are covered by the env/file prechecks
  // instead of by ignoring the CLI's answer, which is what keeps the run gate honest.
  it('answers the fork-only backends that expose no vendor auth-status command', async () => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => {
        if (executable === 'kilo') return connectedResults.kilo!;
        if (executable === 'gemini' || executable === 'agy') return { stdout: '0.61.0\n', stderr: '', exitCode: 0 };
        return { stdout: 'unrecognized', stderr: '', exitCode: 0 };
      }),
    });

    const rows = await statuses(service);
    expect(rows.kilo).toMatchObject({ status: 'connected' });
    // A bare version is the only answer these two CLIs give: installed counts as connected.
    expect(rows.gemini).toMatchObject({ status: 'connected' });
    expect(rows.antigravity).toMatchObject({ status: 'connected' });
    // http has no CLI and no config here, so its absence of configuration IS the answer.
    expect(rows.http).toMatchObject({ status: 'disconnected' });
  });

  it('does not read a failing or hanging CLI as healthy', async () => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => {
        if (executable === 'claude') {
          return { stdout: '', stderr: 'denied', exitCode: null, errorCode: 'EACCES' };
        }
        if (executable.includes('codex')) {
          return { stdout: '', stderr: '', exitCode: null, errorCode: 'ETIMEDOUT', timedOut: true };
        }
        return resultFor(executable);
      }),
    });

    const rows = await statuses(service);
    // A CLI that could not answer is not evidence of a working login.
    expect(rows.claude?.status).not.toBe('connected');
    expect(rows.codex?.status).not.toBe('connected');
  });

  it('reports unknown only when the spawn itself throws', async () => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => {
        if (executable === 'claude') throw new Error('spawn failure');
        return resultFor(executable);
      }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ claude: { status: 'unknown' } });
  });

  it('treats malformed Claude JSON as unknown', async () => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable === 'claude'
        ? { stdout: '{not json', stderr: '', exitCode: 0 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ claude: { status: 'unknown' } });
  });

  it.each([
    'Logged in using ChatGPT',
    'Logged in using an API key',
    'Logged in using Agent Identity',
  ])('recognizes Codex connected output: %s', async (stdout) => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable.includes('codex')
        ? { stdout: `\u001B[32m${stdout}\u001B[0m`, stderr: '', exitCode: 0 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ codex: { status: 'connected' } });
  });

  it.each([
    'Logged in using ChatGPT',
    'Logged in using an API key - sk-proj-***ABCDE',
    'Logged in using access token',
    'Logged in using personal access token',
    'Logged in using Amazon Bedrock API key',
  ])('recognizes current Codex stderr output: %s', async (statusLine) => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable.includes('codex')
        ? {
          stdout: '',
          stderr: [
            'WARNING: experimental feature enabled',
            `\u001B[32m${statusLine}\u001B[0m`,
          ].join('\n'),
          exitCode: 0,
        }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ codex: { status: 'connected' } });
  });

  it('recognizes current Codex not-logged-in stderr on exit 1', async () => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable.includes('codex')
        ? {
          stdout: '',
          stderr: ['WARNING: config migration available', 'Not logged in'].join('\n'),
          exitCode: 1,
        }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ codex: { status: 'disconnected' } });
  });

  it.each([
    {
      case: 'duplicate answers',
      stdout: 'Logged in using ChatGPT',
      stderr: 'Logged in using ChatGPT',
    },
    {
      case: 'conflicting answers',
      stdout: 'Logged in using ChatGPT',
      stderr: 'Not logged in',
    },
  ])('treats Codex $case across output channels as unknown', async ({ stdout, stderr }) => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable.includes('codex')
        ? { stdout, stderr, exitCode: 0 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ codex: { status: 'unknown' } });
  });

  it('never returns the masked Codex API-key identifier', async () => {
    const masked = 'sk-proj-***ABCDE';
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable.includes('codex')
        ? { stdout: '', stderr: `Logged in using an API key - ${masked}`, exitCode: 0 }
        : resultFor(executable)),
    });

    const response = await service.status();
    expect(response.providers.find(({ provider }) => provider === 'codex')).toEqual({
      provider: 'codex',
      status: 'connected',
    });
    expect(JSON.stringify(response)).not.toContain(masked);
  });

  it('does not accept known Codex connected output on an unexpected nonzero exit', async () => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable.includes('codex')
        ? { stdout: 'Logged in using ChatGPT', stderr: '', exitCode: 7 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ codex: { status: 'unknown' } });
  });

  it.each([
    'Not logged in',
    'Run codex login to authenticate',
  ])('recognizes Codex disconnected output: %s', async (stdout) => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable.includes('codex')
        ? { stdout, stderr: '', exitCode: 1 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ codex: { status: 'disconnected' } });
  });

  it('does not accept known Codex disconnected output on exit 0', async () => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable.includes('codex')
        ? { stdout: 'Not logged in', stderr: '', exitCode: 0 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ codex: { status: 'unknown' } });
  });

  it('does not guess from unrecognized Codex output', async () => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable.includes('codex')
        ? { stdout: 'Codex status: account maybe ready', stderr: '', exitCode: 0 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ codex: { status: 'unknown' } });
  });

  it.each([
    [
      'one ANSI-styled credential',
      [
        '\u001B[90m┌  Credentials ~/.local/share/opencode/auth.json\u001B[0m',
        '\u001B[90m│\u001B[0m',
        '\u001B[36m●\u001B[0m  Acme Enterprise \u001B[2moauth\u001B[0m',
        '\u001B[90m│\u001B[0m',
        '\u001B[90m└\u001B[0m  1 credential',
      ].join('\n'),
    ],
    [
      'multiple arbitrary credential rows',
      [
        '┌  Credentials /srv/opencode/auth.json',
        '│',
        '●  Acme Enterprise oauth',
        '●  local-provider api',
        '●  Custom Gateway wellknown',
        '●  Another Provider api',
        '│',
        '└  4 credentials',
      ].join('\n'),
    ],
  ])('recognizes OpenCode %s as connected', async (_case, stdout) => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable === 'opencode'
        ? { stdout, stderr: '', exitCode: 0 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ opencode: { status: 'connected' } });
  });

  it('recognizes an OpenCode decorated zero-credential list as disconnected', async () => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable === 'opencode'
        ? {
          stdout: [
            '┌  Credentials ~/.local/share/opencode/auth.json',
            '│',
            '└  0 credentials',
          ].join('\n'),
          stderr: '',
          exitCode: 0,
        }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ opencode: { status: 'disconnected' } });
  });

  it.each([
    'OpenCode Go  OpenCode Go                 stored',
    [
      '\u001B[36mOpenCode Go\u001B[0m  OpenCode Go                 stored',
      'Anthropic  Claude                 stored',
    ].join('\n'),
  ])('recognizes OpenCode 2.x stored credential rows: %s', async (stdout) => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable === 'opencode'
        ? { stdout, stderr: '', exitCode: 0 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ opencode: { status: 'connected' } });
  });

  it('recognizes an OpenCode 2.x successful empty list as disconnected', async () => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable === 'opencode'
        ? { stdout: '', stderr: '', exitCode: 0 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ opencode: { status: 'disconnected' } });
  });

  it.each([
    ['No authenticated integrations', 'disconnected'],
    ['OpenAI  OPENAI_API_KEY              environment', 'connected'],
  ])('reads OpenCode 2.0.28 plain answer %s', async (stdout, status) => {
    const run = runner((executable) => executable === 'opencode'
      ? { stdout: `${stdout}\n`, stderr: '', exitCode: 0 }
      : { stdout: 'unrecognized', stderr: '', exitCode: 0 });
    const service = new ProviderAuthService({ runCommand: run });

    await expect(statuses(service)).resolves.toMatchObject({ opencode: { status } });
    expect(vi.mocked(run).mock.calls.filter(([executable]) => executable === 'opencode')).toHaveLength(1);
  });

  // Telemetry 107e44a9: OpenCode 2.x answers `auth list` through its background service; one that
  // cannot start fails with exit 1 and a one-line stderr. A private server still answers.
  it.each([
    ['[]', 'disconnected'],
    [JSON.stringify([{ id: 'opencode-go', name: 'OpenCode Go', connections: [{ type: 'credential', label: 'OpenCode Go' }] }]), 'connected'],
  ])('asks OpenCode 2.x with a private server when its background service fails: %s', async (json, status) => {
    const onInconclusive = vi.fn();
    const run = runner((executable, args) => {
      if (executable !== 'opencode') return { stdout: 'unrecognized', stderr: '', exitCode: 0 };
      return args.includes('--standalone')
        ? { stdout: `${json}\n`, stderr: '', exitCode: 0 }
        : { stdout: '', stderr: 'Error: Server process exited with code 1\n', exitCode: 1 };
    });
    const service = new ProviderAuthService({ runCommand: run, onInconclusive });

    await expect(statuses(service)).resolves.toMatchObject({ opencode: { status } });
    expect(run).toHaveBeenCalledWith('opencode', ['auth', 'list', '--standalone', '--format', 'json'], expect.any(Number));
    expect(onInconclusive).not.toHaveBeenCalledWith(expect.objectContaining({ provider: 'opencode' }));
  });

  it.each([
    '{"connections":[]}',
    '[{"id":"x","connections":[]}]',
    '[null]',
  ])('does not guess from malformed OpenCode JSON %s', async (json) => {
    const service = new ProviderAuthService({
      runCommand: runner((executable, args) => {
        if (executable !== 'opencode') return { stdout: 'unrecognized', stderr: '', exitCode: 0 };
        return args.includes('--standalone')
          ? { stdout: json, stderr: '', exitCode: 0 }
          : { stdout: '', stderr: 'Error: Server process exited with code 1\n', exitCode: 1 };
      }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ opencode: { status: 'unknown' } });
  });

  it.each([
    ['not installed', { stdout: '', stderr: '', exitCode: null, errorCode: 'ENOENT' }, 'not-installed', 1],
    ['hung', { stdout: '', stderr: '', exitCode: null, timedOut: true }, 'unknown', 2],
  ] as const)('does not ask OpenCode with a private server when it is %s', async (_name, answer, status, calls) => {
    const run = runner((executable) => executable === 'opencode'
      ? answer
      : { stdout: 'unrecognized', stderr: '', exitCode: 0 });
    const service = new ProviderAuthService({ runCommand: run });

    await expect(statuses(service)).resolves.toMatchObject({ opencode: { status } });
    expect(vi.mocked(run).mock.calls.filter(([executable]) => executable === 'opencode')).toHaveLength(calls);
  });

  it('does not re-ask OpenCode 1.x, which answered but rejects the 2.x flags', async () => {
    const run = runner((executable) => executable === 'opencode'
      ? { stdout: ['┌  Credentials ~/.local/share/opencode/auth.json', '└  credentials: many'].join('\n'), stderr: '', exitCode: 0 }
      : { stdout: 'unrecognized', stderr: '', exitCode: 0 });
    const service = new ProviderAuthService({ runCommand: run });

    await expect(statuses(service)).resolves.toMatchObject({ opencode: { status: 'unknown' } });
    expect(vi.mocked(run).mock.calls.filter(([executable]) => executable === 'opencode')).toHaveLength(1);
  });

  it('keeps OpenCode stderr-only CLI failures out of unrecognized-output telemetry', async () => {
    const onInconclusive = vi.fn();
    const run = runner((executable, args) => executable === 'opencode'
      ? args.includes('--standalone')
        ? { stdout: '', stderr: 'error: unknown flag --standalone\n', exitCode: 1 }
        : { stdout: '', stderr: 'Error: Cannot start server\n', exitCode: 1 }
      : { stdout: 'unrecognized', stderr: '', exitCode: 0 });
    const service = new ProviderAuthService({ runCommand: run, onInconclusive });

    await expect(statuses(service)).resolves.toMatchObject({ opencode: { status: 'unknown' } });
    expect(onInconclusive).not.toHaveBeenCalledWith(expect.objectContaining({ provider: 'opencode' }));
  });

  it('does not guess from a malformed OpenCode 2.x credential row', async () => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable === 'opencode'
        ? { stdout: 'OpenCode Go stored maybe', stderr: '', exitCode: 0 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ opencode: { status: 'unknown' } });
  });

  it.each([
    [
      'one environment variable',
      [
        '┌  Credentials ~/.local/share/opencode/auth.json',
        '│',
        '└  0 credentials',
        '',
        '┌  Environment',
        '│',
        '●  Anthropic ANTHROPIC_API_KEY',
        '│',
        '└  1 environment variable',
      ].join('\n'),
    ],
    [
      'multiple environment variables',
      [
        '\u001B[90m┌  Credentials /srv/opencode/auth.json\u001B[0m',
        '\u001B[90m│\u001B[0m',
        '\u001B[90m└\u001B[0m  0 credentials',
        '',
        '\u001B[90m┌  Environment\u001B[0m',
        '\u001B[90m│\u001B[0m',
        '\u001B[36m●\u001B[0m  Acme ACME_API_KEY',
        '\u001B[36m●\u001B[0m  Custom Gateway CUSTOM_TOKEN',
        '\u001B[90m│\u001B[0m',
        '\u001B[90m└\u001B[0m  2 environment variables',
      ].join('\n'),
    ],
  ])('recognizes OpenCode zero stored credentials plus %s as connected', async (_case, stdout) => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable === 'opencode'
        ? { stdout, stderr: '', exitCode: 0 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ opencode: { status: 'connected' } });
  });

  it.each([
    [
      'a missing stored-credential summary',
      [
        '┌  Environment',
        '●  Acme ACME_API_KEY',
        '└  1 environment variable',
      ].join('\n'),
    ],
    [
      'duplicate stored-credential summaries',
      [
        '┌  Credentials ~/.local/share/opencode/auth.json',
        '└  0 credentials',
        '└  1 credential',
      ].join('\n'),
    ],
    [
      'conflicting environment summaries',
      [
        '┌  Credentials ~/.local/share/opencode/auth.json',
        '└  0 credentials',
        '┌  Environment',
        '└  1 environment variable',
        '└  2 environment variables',
      ].join('\n'),
    ],
    [
      'a malformed environment summary',
      [
        '┌  Credentials ~/.local/share/opencode/auth.json',
        '└  0 credentials',
        '┌  Environment',
        '└  environment variables: many',
      ].join('\n'),
    ],
    [
      'an environment summary without its block',
      [
        '┌  Credentials ~/.local/share/opencode/auth.json',
        '└  0 credentials',
        '└  1 environment variable',
      ].join('\n'),
    ],
    [
      'an unsafe environment count',
      [
        '┌  Credentials ~/.local/share/opencode/auth.json',
        '└  0 credentials',
        '┌  Environment',
        '└  9007199254740992 environment variables',
      ].join('\n'),
    ],
  ])('treats OpenCode output with %s as unknown', async (_case, stdout) => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable === 'opencode'
        ? { stdout, stderr: '', exitCode: 0 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ opencode: { status: 'unknown' } });
  });

  it('does not accept an OpenCode credential summary on an unexpected nonzero exit', async () => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable === 'opencode'
        ? { ...connectedResults.opencode!, exitCode: 7 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ opencode: { status: 'unknown' } });
  });

  it.each([
    'New auth output format v99',
    ['┌  Credentials ~/.local/share/opencode/auth.json', '└  credentials: many'].join('\n'),
  ])('does not guess from OpenCode output without a valid count summary', async (stdout) => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable === 'opencode'
        ? { stdout, stderr: 'error', exitCode: 0 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ opencode: { status: 'unknown' } });
  });

  it('recognizes Cursor isAuthenticated: true as connected', async () => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => (executable === 'agent' || executable.includes('cursor'))
        ? { stdout: JSON.stringify({ isAuthenticated: true }), stderr: '', exitCode: 0 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ cursor: { status: 'connected' } });
  });

  it('recognizes Cursor isAuthenticated: false with no CURSOR_API_KEY as disconnected', async () => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => (executable === 'agent' || executable.includes('cursor'))
        ? { stdout: JSON.stringify({ isAuthenticated: false }), stderr: '', exitCode: 0 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ cursor: { status: 'disconnected' } });
  });

  it('treats malformed Cursor JSON with no CURSOR_API_KEY as unknown', async () => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => (executable === 'agent' || executable.includes('cursor'))
        ? { stdout: 'not json', stderr: '', exitCode: 0 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ cursor: { status: 'unknown' } });
  });

  // Cursor CLIs up to 2026.01.28 reject `status --format json` (exit 1); verified live.
  it.each([
    ['\u001B[2K\u001B[G\n Starting login process...\n\u001B[2K\u001B[1A\u001B[2K\u001B[G\n ✓ Logged in as me@example.com\n', 'connected'],
    ['\u001B[2K\u001B[G\n Starting login process...\n\u001B[2K\u001B[1A\u001B[2K\u001B[G Not logged in\n', 'disconnected'],
  ])('reads plain `status` from a Cursor CLI that predates --format', async (stdout, expected) => {
    const onInconclusive = vi.fn();
    const runCommand = vi.fn<RunProviderCommand>(async (executable, args) => {
      if (executable !== 'agent') return resultFor(executable);
      return args.includes('--format')
        ? { stdout: '', stderr: "error: unknown option '--format'\n(Did you mean --force?)\n", exitCode: 1 }
        : { stdout, stderr: '', exitCode: 0 };
    });
    const service = new ProviderAuthService({ runCommand, onInconclusive });

    await expect(statuses(service)).resolves.toMatchObject({ cursor: { status: expected } });
    expect(runCommand).toHaveBeenCalledWith('agent', ['status'], 10_000);
    expect(onInconclusive).not.toHaveBeenCalled();
  });

  // Telemetry 1cd541cc: the --format rejection worded by other arg parsers, and plain-status variants.
  it.each([
    ["error: unknown option '--format'\n(Did you mean --force?)\n", ' ✓ Logged in as me@example.com\n', 'connected'],
    ['Unknown argument: format\n', 'Signed in as me@example.com\n', 'connected'],
    ["error: unexpected argument '--format' found\n", '✗ You are not logged in. Run `agent login`.\n', 'disconnected'],
    ['Unrecognized flag: --format\n', "You're not signed in\n", 'disconnected'],
  ])('falls back to plain `status` when --format is rejected as %j', async (stderr, stdout, expected) => {
    const onInconclusive = vi.fn();
    const runCommand = vi.fn<RunProviderCommand>(async (executable, args) => {
      if (executable !== 'agent') return resultFor(executable);
      return args.includes('--format') ? { stdout: '', stderr, exitCode: 1 } : { stdout, stderr: '', exitCode: 0 };
    });
    const service = new ProviderAuthService({ runCommand, onInconclusive });

    await expect(statuses(service)).resolves.toMatchObject({ cursor: { status: expected } });
    expect(onInconclusive).not.toHaveBeenCalled();
  });

  it('does not fall back on an unrelated status failure', async () => {
    const runCommand = vi.fn<RunProviderCommand>(async (executable) => executable === 'agent'
      ? { stdout: '', stderr: 'error: network unreachable\n', exitCode: 1 }
      : resultFor(executable));
    const service = new ProviderAuthService({ runCommand });

    await expect(statuses(service)).resolves.toMatchObject({ cursor: { status: 'unknown' } });
    expect(runCommand).not.toHaveBeenCalledWith('agent', ['status'], 10_000);
  });

  it('never reads "not logged in as" as signed out', async () => {
    const runCommand = vi.fn<RunProviderCommand>(async (executable, args) => {
      if (executable !== 'agent') return resultFor(executable);
      return args.includes('--format')
        ? { stdout: '', stderr: "error: unknown option '--format'\n", exitCode: 1 }
        : { stdout: 'not logged in as an admin\n', stderr: '', exitCode: 0 };
    });
    const service = new ProviderAuthService({ runCommand });

    await expect(statuses(service)).resolves.toMatchObject({ cursor: { status: 'unknown' } });
  });

  // Telemetry 8d304c50: another program named `agent` (0.2.22) exited 2 with a usage error.
  it('names the PATH shadowing when `agent` answers like a different program', async () => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable === 'agent'
        ? { stdout: '', stderr: 'usage: agent [-h] {run,serve}\nagent: error: invalid choice', exitCode: 2 }
        : resultFor(executable)),
    });

    const cursor = (await statuses(service)).cursor;
    expect(cursor?.status).toBe('unknown');
    expect(cursor?.hint).toContain('CEZ_CURSOR_AGENT_BIN');
  });

  // Telemetry 8d304c50 regressed after #1503: no Cursor at all, so resolution still ends at the foreign `agent`.
  it('reports not-installed, unreported, when the only `agent` is another program', async () => {
    const onInconclusive = vi.fn();
    const runCommand = vi.fn<RunProviderCommand>(async (executable, args) => {
      if (executable !== 'agent') return resultFor(executable);
      return args.includes('--version')
        ? { stdout: '0.2.22\n', stderr: '', exitCode: 0 }
        : { stdout: '', stderr: 'usage: agent [-h] {run,serve}\nagent: error: invalid choice', exitCode: 2 };
    });
    const service = new ProviderAuthService({ runCommand, onInconclusive });

    const cursor = (await statuses(service)).cursor;
    expect(cursor?.status).toBe('not-installed');
    expect(cursor?.hint).toContain('CEZ_CURSOR_AGENT_BIN');
    expect(onInconclusive).not.toHaveBeenCalled();
  });

  it.each([
    ['Cursor itself', 'agent', undefined, '2026.01.28-fd13201\n'],
    ['an explicit override', 'agent', 'agent', '0.2.22\n'],
    ['an unreadable version', 'agent', undefined, 'agent: error\n'],
  ])('keeps an unreadable status unknown for %s', async (_label, executable, override, version) => {
    if (override) process.env.CEZ_CURSOR_AGENT_BIN = override;
    const onInconclusive = vi.fn();
    const runCommand = vi.fn<RunProviderCommand>(async (bin, args) => {
      if (bin !== executable) return resultFor(bin);
      return args.includes('--version')
        ? { stdout: version, stderr: '', exitCode: 0 }
        : { stdout: '', stderr: 'boom', exitCode: 2 };
    });
    const service = new ProviderAuthService({ runCommand, onInconclusive });

    await expect(statuses(service)).resolves.toMatchObject({ cursor: { status: 'unknown' } });
    expect(onInconclusive).toHaveBeenCalledWith(expect.objectContaining({ provider: 'cursor', reason: 'unexpected_exit' }));
  });

  describe('Cursor CURSOR_API_KEY precheck', () => {
    it('reports connected WITHOUT spawning `agent status` at all when CURSOR_API_KEY is set', async () => {
      process.env.CURSOR_API_KEY = 'sk-test-key';
      const runCommand = vi.fn<RunProviderCommand>(async (executable) => resultFor(executable));
      const service = new ProviderAuthService({ runCommand });

      await expect(statuses(service)).resolves.toMatchObject({ cursor: { status: 'connected' } });
      expect(runCommand).not.toHaveBeenCalledWith('agent', expect.anything(), expect.anything());
    });

    // The precheck answers before the process is even spawned, so a hanging `agent status`
    // can no longer hide a valid CURSOR_API_KEY. Only the cursor executable hangs here — the
    // other providers resolve normally, so a regression that makes cursor wait on the real
    // probe fails this test instead of hanging it.
    it('is unaffected by `agent status` hanging past the probe timeout', async () => {
      process.env.CURSOR_API_KEY = 'sk-test-key';
      const runCommand = vi.fn<RunProviderCommand>(async (executable) =>
        executable === 'agent' ? new Promise<never>(() => {}) : resultFor(executable));
      const service = new ProviderAuthService({ runCommand });

      await expect(statuses(service)).resolves.toMatchObject({ cursor: { status: 'connected' } });
      expect(runCommand).not.toHaveBeenCalledWith('agent', expect.anything(), expect.anything());
    });

    it('ignores a whitespace-only CURSOR_API_KEY and falls back to the CLI probe', async () => {
      process.env.CURSOR_API_KEY = '   ';
      const service = new ProviderAuthService({
        runCommand: runner((executable) => (executable === 'agent' || executable.includes('cursor'))
          ? { stdout: JSON.stringify({ isAuthenticated: false }), stderr: '', exitCode: 0 }
          : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
      });

      await expect(statuses(service)).resolves.toMatchObject({ cursor: { status: 'disconnected' } });
    });
  });

  it('does not guess pi\'s login from an unreadable model list', async () => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable === 'pi'
        ? { stdout: 'Models may be available', stderr: 'private detail', exitCode: 0 }
        : { stdout: 'unrecognized', stderr: '', exitCode: 0 }),
    });

    await expect(statuses(service)).resolves.toMatchObject({ pi: { status: 'unknown' } });
  });
});

describe('ProviderAuthService', () => {
  it('always returns every provider in descriptor order', async () => {
    const service = new ProviderAuthService({ runCommand: runner() });

    await expect(service.status()).resolves.toMatchObject({
      providers: [
        { provider: 'claude' },
        { provider: 'codex' },
        { provider: 'opencode' },
        { provider: 'cursor' },
        { provider: 'pi' },
        { provider: 'junie', status: 'connected' },
        { provider: 'copilot' },
        { provider: 'kilo' },
        { provider: 'gemini' },
        { provider: 'antigravity' },
        { provider: 'http', status: 'disconnected' }, // precheck returns disconnected when no config
      ],
    });
  });

  it('runs every status command concurrently with a 10 second timeout', async () => {
    const calls: Array<{ executable: string; args: readonly string[]; timeoutMs: number }> = [];
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const runCommand = vi.fn(async (executable, args, timeoutMs) => {
      calls.push({ executable, args, timeoutMs });
      await waiting;
      return resultFor(executable);
    });
    const service = new ProviderAuthService({ runCommand });
    const pending = service.status();

    await vi.waitFor(() => expect(calls).toHaveLength(PROBE_ROUND));
    expect(calls).toEqual([
      { executable: 'claude', args: ['auth', 'status', '--json'], timeoutMs: 10_000 },
      { executable: 'codex', args: ['login', 'status'], timeoutMs: 10_000 },
      { executable: 'opencode', args: ['auth', 'list'], timeoutMs: 10_000 },
      { executable: 'agent', args: ['status', '--format', 'json'], timeoutMs: 10_000 },
      { executable: 'pi', args: ['--list-models'], timeoutMs: 10_000 },
      { executable: 'copilot', args: ['--acp', '--no-auto-update'], timeoutMs: 10_000 },
      { executable: 'kilo', args: ['auth', 'list'], timeoutMs: 10_000 },
      { executable: 'gemini', args: ['--version'], timeoutMs: 10_000 },
      { executable: 'agy', args: ['--version'], timeoutMs: 10_000 },
    ]);
    release();
    await expect(pending).resolves.toBeDefined();
  });

  it('maps an ENOENT command failure to not-installed', async () => {
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable === 'codex'
        ? { stdout: '', stderr: '', exitCode: null, errorCode: 'ENOENT' }
        : resultFor(executable)),
    });

    await expect(statuses(service)).resolves.toMatchObject({ codex: { status: 'not-installed' } });
  });

  it.each(['ETIMEDOUT', 'EACCES'])('does not read %s as a working login, nor expose raw output', async (errorCode) => {
    const secret = 'provider-auth-sentinel-secret';
    const service = new ProviderAuthService({
      runCommand: runner((executable) => executable === 'codex'
        ? {
          stdout: errorCode === 'EACCES' ? 'Logged in using ChatGPT' : secret,
          stderr: secret,
          exitCode: null,
          errorCode,
          timedOut: errorCode === 'ETIMEDOUT',
        }
        : resultFor(executable)),
    });

    const response = await service.status();
    const codex = response.providers.find(({ provider }) => provider === 'codex');
    // A CLI that never answered is not evidence of a working login. The raw output still never
    // reaches the client.
    expect(codex?.status).not.toBe('connected');
    expect(JSON.stringify(response)).not.toContain(secret);
  });

  describe('cache lifetime is asymmetric on purpose', () => {
    it('keeps an all-connected answer for MINUTES — it is what every run needs and rarely changes', async () => {
      let now = 1_000;
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand, now: () => now });

      await service.status();
      now += 9 * 60_000;
      await service.status();
      // Still four: one probe per provider, from the first call only.
      expect(runCommand).toHaveBeenCalledTimes(PROBE_ROUND);
    });

    it('re-probes an all-connected answer once the long window passes', async () => {
      let now = 1_000;
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand, now: () => now });

      await service.status();
      now += 10 * 60_000 + 1;
      await service.status();
      expect(runCommand).toHaveBeenCalledTimes(PROBE_ROUND * 2);
    });

    it('re-checks a NOT-connected answer sooner, so a missing binary is noticed on its own', async () => {
      // cezar cannot see a CLI being installed, so a card that says not-installed has to find
      // out for itself. A minute, not seconds: every expiry costs a background probe now that
      // reading revalidates behind the answer, and a polling cockpit would turn a five-second
      // window into a spawn every five seconds forever.
      let now = 1_000;
      const runCommand = runner((executable) =>
        executable === 'claude'
          ? { stdout: '', stderr: '', exitCode: null, errorCode: 'ENOENT' }
          : resultFor(executable));
      const service = new ProviderAuthService({ runCommand, now: () => now });

      await service.status();
      now += 59_999;
      await service.status();
      expect(runCommand).toHaveBeenCalledTimes(PROBE_ROUND); // still inside the short window
      now += 2;
      await service.status();
      expect(runCommand).toHaveBeenCalledTimes(PROBE_ROUND * 2); // past it → re-probed
    });

    it('serves the stale answer immediately and refreshes BEHIND it, never in front', async () => {
      // The bug this fixes: `GET /api/v1/providers/status` awaited the re-probe, so every lapse of
      // the window made one reader pay ~0.8s (~3s on a slower box) for an endpoint the cockpit
      // polls. Measured on the built server before the change: 3ms, 3ms, then 817ms.
      let now = 1_000;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let probes = 0;
      const service = new ProviderAuthService({
        now: () => now,
        runCommand: async (executable) => {
          probes += 1;
          if (probes > PROBE_ROUND) await gate; // only the SECOND round of probes hangs
          return resultFor(executable);
        },
      });

      await service.status();
      now += 11 * 60_000; // past even the long window

      // Resolves while the refresh is still hanging — that is the whole point.
      await expect(service.status()).resolves.toMatchObject({
        providers: expect.arrayContaining([
          expect.objectContaining({ provider: 'claude', status: 'connected' }),
        ]),
      });
      expect(probes).toBe(PROBE_ROUND * 2); // …and it did kick the refresh off

      // A reader arriving mid-revalidation is served from cache too, not attached to the probe.
      await expect(service.status()).resolves.toBeDefined();
      expect(probes).toBe(PROBE_ROUND * 2); // no second refresh piled on top
      release();
    });

    it('waits when NOTHING is known yet — there is no stale answer to serve', async () => {
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand, now: () => 1_000 });
      await expect(service.status()).resolves.toMatchObject({
        providers: expect.arrayContaining([
          expect.objectContaining({ provider: 'claude', status: 'connected' }),
        ]),
      });
      expect(runCommand).toHaveBeenCalledTimes(PROBE_ROUND);
    });

    it('applies the same asymmetry per account', async () => {
      let now = 1_000;
      const runCommand = runner((_executable, _args) => connectedResults.claude!);
      const service = new ProviderAuthService({ runCommand, now: () => now });

      await service.profileStatus('claude', { id: 'work', configDir: '/work' });
      now += 9 * 60_000;
      await service.profileStatus('claude', { id: 'work', configDir: '/work' });
      expect(runCommand).toHaveBeenCalledTimes(1);
    });
  });

  it('refresh bypasses a completed cache entry', async () => {
    const runCommand = runner();
    const service = new ProviderAuthService({ runCommand, now: () => 1_000 });

    await service.status();
    await service.status({ refresh: true });
    expect(runCommand).toHaveBeenCalledTimes(PROBE_ROUND * 2);
  });

  it('keeps one incident id until an explicit matching clear and creates a new id afterward', async () => {
    const ids = ['incident-1', 'incident-2'];
    const service = new ProviderAuthService({
      platform: 'linux',
      runCommand: runner(),
      createAuthFailureId: () => ids.shift()!,
    });

    const first = service.reportRuntimeAuthFailure('claude');
    expect(first).not.toBeNull();
    if (!first) throw new Error('runtime incident was not created');
    expect(first).toEqual({
      transitioned: true,
      status: {
        provider: 'claude',
        status: 'disconnected',
        hint: 'Authentication was rejected during a run. Reconnect, then try again.',
        authFailureId: 'incident-1',
      },
    });
    expect(service.reportRuntimeAuthFailure('claude')).toEqual({
      transitioned: false,
      status: first.status,
    });
    await expect(service.status()).resolves.toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({ provider: 'claude', authFailureId: 'incident-1' }),
      ]),
    });

    expect(service.clearRuntimeAuthFailure('claude', 'stale')).toBe(false);
    expect(service.clearRuntimeAuthFailure('claude', first.status.authFailureId)).toBe(true);

    expect(service.reportRuntimeAuthFailure('claude')).toMatchObject({
      status: { authFailureId: 'incident-2' },
    });
  });

  it('does not clear a runtime latch when an ordinary fresh probe finds credentials', async () => {
    const service = new ProviderAuthService({ runCommand: runner() });
    const report = service.reportRuntimeAuthFailure('claude');
    expect(report).not.toBeNull();
    if (!report) throw new Error('runtime incident was not created');
    const incident = report.status.authFailureId;

    await expect(service.status({ refresh: true })).resolves.toMatchObject({
      providers: expect.arrayContaining([expect.objectContaining({
        provider: 'claude',
        status: 'disconnected',
        authFailureId: incident,
      })]),
    });
    expect(service.clearRuntimeAuthFailure('claude', incident)).toBe(true);
    await expect(service.status()).resolves.toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({ provider: 'claude', status: 'connected' }),
      ]),
    });
  });

  describe('a named account carries its own runtime incident (telemetry 9e4a95db)', () => {
    const account = { id: 'work', configDir: '/accounts/work' };

    it('marks only that account, and leaves the default login connected', async () => {
      const service = new ProviderAuthService({ runCommand: runner(), createAuthFailureId: () => 'incident-1' });
      await service.profileStatus('claude', account);

      expect(service.reportProfileAuthFailure('claude', 'work')).toMatchObject({ transitioned: true });
      expect(service.reportProfileAuthFailure('claude', 'work')).toMatchObject({ transitioned: false });

      await expect(statuses(service)).resolves.toMatchObject({ claude: { status: 'connected' } });
      // Within the cached connected answer's lifetime, the incident still wins.
      await expect(service.profileStatus('claude', account)).resolves.toMatchObject({
        status: 'disconnected', authFailureId: 'incident-1', profileId: 'work',
      });
      expect(service.peekProfileStatus('claude', 'other')).toBeUndefined();
    });

    it('is known to a peek before the account was ever probed', () => {
      const service = new ProviderAuthService({ runCommand: runner(), createAuthFailureId: () => 'incident-1' });
      service.reportProfileAuthFailure('claude', 'work');

      expect(service.peekProfileStatus('claude', 'work')).toMatchObject({
        provider: 'claude', status: 'disconnected', authFailureId: 'incident-1', profileId: 'work',
      });
    });

    it('lifts on a fresh connected probe of that account, and not on a disconnected one', async () => {
      const answers: ProviderCommandResult[] = [
        { stdout: '{"loggedIn":false}', stderr: '', exitCode: 1 },
        { stdout: '{"loggedIn":true}', stderr: '', exitCode: 0 },
      ];
      const service = new ProviderAuthService({
        runCommand: runner((executable) => (executable === 'claude' ? answers.shift()! : resultFor(executable))),
        createAuthFailureId: () => 'incident-1',
      });
      service.reportProfileAuthFailure('claude', 'work');

      await expect(service.profileStatus('claude', account)).resolves.toMatchObject({ status: 'disconnected', authFailureId: 'incident-1' });
      service.forgetProfileStatus('claude', 'work');
      await expect(service.profileStatus('claude', account)).resolves.toEqual({ provider: 'claude', status: 'connected', profileId: 'work' });
      expect(service.peekProfileStatus('claude', 'work')).toEqual({ provider: 'claude', status: 'connected', profileId: 'work' });
    });

    it('is dropped with the account, and kept by a plain cache refresh', () => {
      const service = new ProviderAuthService({ runCommand: runner(), createAuthFailureId: () => 'incident-1' });
      service.reportProfileAuthFailure('claude', 'work');

      service.forgetProfileStatus('claude', 'work');
      expect(service.peekProfileStatus('claude', 'work')).toMatchObject({ status: 'disconnected' });
      service.forgetProfile('claude', 'work');
      expect(service.peekProfileStatus('claude', 'work')).toBeUndefined();
    });

    it('survives a probe that was already running when the rejection arrived', async () => {
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => { release = resolve; });
      const runCommand = vi.fn(async (executable: string) => {
        await waiting;
        return resultFor(executable);
      });
      const service = new ProviderAuthService({ runCommand, createAuthFailureId: () => 'incident-1' });

      const probing = service.profileStatus('claude', account);
      await vi.waitFor(() => expect(runCommand).toHaveBeenCalledTimes(1));
      service.reportProfileAuthFailure('claude', 'work');
      release();

      await expect(probing).resolves.toMatchObject({ status: 'disconnected', authFailureId: 'incident-1' });
      expect(service.peekProfileStatus('claude', 'work')).toMatchObject({ status: 'disconnected' });
    });
  });

  describe('a latch verifies itself against the provider CLI', () => {
    const loggedOutClaude: ProviderCommandResult = {
      stdout: '{"loggedIn":false}',
      stderr: '',
      exitCode: 1,
    };

    it('clears the incident when the CLI is still logged in', async () => {
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand, createAuthFailureId: () => 'incident-1' });
      service.reportRuntimeAuthFailure('claude');

      await expect(service.verifyRuntimeAuthFailure('claude'))
        .resolves.toEqual({ provider: 'claude', status: 'connected' });
      // Only the rejected provider is asked — the other three were never accused of anything.
      expect(runCommand).toHaveBeenCalledTimes(1);
      expect(runCommand).toHaveBeenCalledWith('claude', ['auth', 'status', '--json'], 10_000);
      await expect(statuses(service)).resolves.toMatchObject({ claude: { status: 'connected' } });
    });

    it('keeps the incident while the CLI still answers logged out', async () => {
      // The probe parses the vendor's answer, so "not logged in" is not evidence of health and
      // the latch stays until a real reconnect.
      const service = new ProviderAuthService({
        runCommand: runner((executable) => (executable === 'claude' ? loggedOutClaude : resultFor(executable))),
        createAuthFailureId: () => 'incident-1',
      });
      service.reportRuntimeAuthFailure('claude');

      // The CLI still answers "not logged in", so nothing clears the latch.
      await expect(service.verifyRuntimeAuthFailure('claude')).resolves.toBeNull();
      await expect(service.status()).resolves.toMatchObject({
        providers: expect.arrayContaining([
          expect.objectContaining({ provider: 'claude', status: 'disconnected' }),
        ]),
      });
    });

    it.each(['not-installed', 'thrown'] as const)(
      'treats an inconclusive probe (%s) as no evidence of health',
      async (kind) => {
        const runCommand = kind === 'not-installed'
          ? runner((executable) => (executable === 'claude'
            ? { stdout: '', stderr: '', exitCode: null, errorCode: 'ENOENT' }
            : resultFor(executable)))
          : runner((executable) => {
            if (executable === 'claude') throw new Error('spawn failure');
            return resultFor(executable);
          });
        const service = new ProviderAuthService({
          runCommand,
          createAuthFailureId: () => 'incident-1',
        });
        service.reportRuntimeAuthFailure('claude');

        await expect(service.verifyRuntimeAuthFailure('claude')).resolves.toBeNull();
        await expect(service.status()).resolves.toMatchObject({
          providers: expect.arrayContaining([
            expect.objectContaining({ provider: 'claude', authFailureId: 'incident-1' }),
          ]),
        });
      },
    );

    it('spawns at most one probe per provider per cooldown window', async () => {
      const ids = ['incident-1', 'incident-2', 'incident-3'];
      let now = 1_000;
      const runCommand = runner();
      const service = new ProviderAuthService({
        runCommand,
        now: () => now,
        createAuthFailureId: () => ids.shift()!,
      });

      service.reportRuntimeAuthFailure('claude');
      await expect(service.verifyRuntimeAuthFailure('claude')).resolves.not.toBeNull();
      expect(runCommand).toHaveBeenCalledTimes(1);

      // The run keeps failing: a fresh latch inside the window must not buy a fresh spawn.
      service.reportRuntimeAuthFailure('claude');
      now += 59_000;
      await expect(service.verifyRuntimeAuthFailure('claude')).resolves.toBeNull();
      expect(runCommand).toHaveBeenCalledTimes(1);

      now += 2_000;
      await expect(service.verifyRuntimeAuthFailure('claude')).resolves.not.toBeNull();
      expect(runCommand).toHaveBeenCalledTimes(2);
    });

    it('never answers an older question: a rejection arriving mid-probe survives', async () => {
      const ids = ['incident-1', 'incident-2'];
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => { release = resolve; });
      const runCommand = vi.fn(async (executable: string) => {
        await waiting;
        return resultFor(executable);
      });
      const service = new ProviderAuthService({ runCommand, createAuthFailureId: () => ids.shift()! });
      service.reportRuntimeAuthFailure('claude');

      const verifying = service.verifyRuntimeAuthFailure('claude');
      await vi.waitFor(() => expect(runCommand).toHaveBeenCalledTimes(1));
      // Recovery began, then the user acknowledged incident-1 and the runner rejected them again.
      expect(service.clearRuntimeAuthFailure('claude', 'incident-1')).toBe(true);
      service.reportRuntimeAuthFailure('claude');
      release();

      await expect(verifying).resolves.toBeNull();
      await expect(service.status()).resolves.toMatchObject({
        providers: expect.arrayContaining([
          expect.objectContaining({ provider: 'claude', status: 'disconnected', authFailureId: 'incident-2' }),
        ]),
      });
    });

    it('collapses concurrent self-checks onto the one already in flight', async () => {
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => { release = resolve; });
      const runCommand = vi.fn(async (executable: string) => {
        await waiting;
        return resultFor(executable);
      });
      const service = new ProviderAuthService({ runCommand, createAuthFailureId: () => 'incident-1' });
      service.reportRuntimeAuthFailure('claude');

      const first = service.verifyRuntimeAuthFailure('claude');
      await vi.waitFor(() => expect(runCommand).toHaveBeenCalledTimes(1));
      await expect(service.verifyRuntimeAuthFailure('claude')).resolves.toBeNull();
      release();

      await expect(first).resolves.toEqual({ provider: 'claude', status: 'connected' });
      expect(runCommand).toHaveBeenCalledTimes(1);
    });

    it('folds the verified row into the cache instead of uncovering an older answer', async () => {
      // What the cockpit last heard about Claude (binary missing), then what the reinstall
      // looks like when the latch is checked.
      const claudeAnswers: ProviderCommandResult[] = [
        { stdout: '', stderr: '', exitCode: null, errorCode: 'ENOENT' },
        { stdout: '{"loggedIn":true}', stderr: '', exitCode: 0 },
      ];
      const service = new ProviderAuthService({
        runCommand: runner((executable) => (
          executable === 'claude'
            ? claudeAnswers.shift() ?? connectedResults.claude!
            : resultFor(executable)
        )),
        now: () => 1_000,
        createAuthFailureId: () => 'incident-1',
      });

      await expect(statuses(service)).resolves.toMatchObject({ claude: { status: 'not-installed' } });
      service.reportRuntimeAuthFailure('claude');
      await expect(service.verifyRuntimeAuthFailure('claude'))
        .resolves.toEqual({ provider: 'claude', status: 'connected' });

      // peekStatus never spawns, so this is the cache itself: dropping the latch must not put the
      // stale `not-installed` back on screen in place of the answer the self-check just got.
      expect(service.peekStatus()).toMatchObject({
        providers: expect.arrayContaining([
          expect.objectContaining({ provider: 'claude', status: 'connected' }),
        ]),
      });
    });

    it('is a no-op when nothing was latched', async () => {
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      await expect(service.verifyRuntimeAuthFailure('claude')).resolves.toBeNull();
      expect(runCommand).not.toHaveBeenCalled();
    });

    it.each(['CEZ_DRY_RUN', 'CEZ_AGENT_MODELS_LOCKED'])(
      'probes nothing under %s=1',
      async (variable) => {
        process.env[variable] = '1';
        const runCommand = runner();
        const service = new ProviderAuthService({ runCommand });

        await expect(service.verifyRuntimeAuthFailure('claude')).resolves.toBeNull();
        expect(runCommand).not.toHaveBeenCalled();
      },
    );
  });

  it('applies a runtime failure that arrives while an ordinary probe is in flight', async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const runCommand = vi.fn(async (executable: string) => {
      await waiting;
      return resultFor(executable);
    });
    const service = new ProviderAuthService({ runCommand });

    const pending = service.status();
    await vi.waitFor(() => expect(runCommand).toHaveBeenCalledTimes(PROBE_ROUND));
    service.reportRuntimeAuthFailure('claude');
    release();

    await expect(pending.then(({ providers }) => providers[0])).resolves.toMatchObject({
      provider: 'claude',
      status: 'disconnected',
    });
  });

  it('rejects a stale clear after a newer incident replaces it', async () => {
    const ids = ['incident-1', 'incident-2'];
    const service = new ProviderAuthService({
      runCommand: runner(),
      createAuthFailureId: () => ids.shift()!,
    });
    const firstReport = service.reportRuntimeAuthFailure('claude');
    expect(firstReport).not.toBeNull();
    if (!firstReport) throw new Error('runtime incident was not created');
    const first = firstReport.status.authFailureId;

    expect(service.clearRuntimeAuthFailure('claude', first)).toBe(true);
    const secondReport = service.reportRuntimeAuthFailure('claude');
    expect(secondReport).not.toBeNull();
    if (!secondReport) throw new Error('runtime incident was not created');
    const second = secondReport.status.authFailureId;

    expect(service.clearRuntimeAuthFailure('claude', first)).toBe(false);
    await expect(service.status()).resolves.toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({ provider: 'claude', authFailureId: second }),
      ]),
    });
  });

  it('keeps CEZ_DRY_RUN connected and ignores runtime invalidation', async () => {
    process.env.CEZ_DRY_RUN = '1';
    const createAuthFailureId = vi.fn(() => 'unused-incident');
    const service = new ProviderAuthService({ runCommand: runner(), createAuthFailureId });

    expect(service.reportRuntimeAuthFailure('claude')).toBeNull();
    expect(createAuthFailureId).not.toHaveBeenCalled();
    await expect(statuses(service)).resolves.toMatchObject({ claude: { status: 'connected' } });
  });

  it('keeps exact CEZ_AGENT_MODELS_LOCKED=1 connected without credential probes or runtime invalidation', async () => {
    process.env.CEZ_AGENT_MODELS_LOCKED = '1';
    const runCommand = runner();
    const createAuthFailureId = vi.fn(() => 'unused-incident');
    const service = new ProviderAuthService({ runCommand, createAuthFailureId });

    expect(providerAuthChecksDisabled()).toBe(true);
    expect(service.reportRuntimeAuthFailure('claude')).toBeNull();
    await expect(service.status({ refresh: true })).resolves.toEqual({
      providers: [
        { provider: 'claude', status: 'connected' },
        { provider: 'codex', status: 'connected' },
        { provider: 'opencode', status: 'connected' },
        { provider: 'cursor', status: 'connected' },
        { provider: 'pi', status: 'connected' },
        { provider: 'junie', status: 'connected' },
        { provider: 'copilot', status: 'connected' },
        { provider: 'kilo', status: 'connected' },
        { provider: 'gemini', status: 'connected' },
        { provider: 'antigravity', status: 'connected' },
        { provider: 'http', status: 'connected' },
      ],
    });
    expect(runCommand).not.toHaveBeenCalled();
    expect(createAuthFailureId).not.toHaveBeenCalled();
  });

  it.each(['0', 'true', 'yes', ''])(
    'does not disable provider checks for CEZ_AGENT_MODELS_LOCKED=%j',
    (value) => {
      process.env.CEZ_AGENT_MODELS_LOCKED = value;
      expect(providerAuthChecksDisabled()).toBe(false);
    },
  );

  it('coalesces ordinary and refresh callers while a probe is in flight', async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const runCommand = vi.fn(async (executable: string) => {
      await waiting;
      return resultFor(executable);
    });
    const service = new ProviderAuthService({ runCommand });

    const ordinary = service.status();
    const refresh = service.status({ refresh: true });
    expect(refresh).toBe(ordinary);
    await vi.waitFor(() => expect(runCommand).toHaveBeenCalledTimes(PROBE_ROUND));
    release();
    await expect(Promise.all([ordinary, refresh])).resolves.toHaveLength(2);
    expect(runCommand).toHaveBeenCalledTimes(PROBE_ROUND);
  });

  it('gives ordinary callers one shared visible promise for a fresh probe after a latch', async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const runCommand = vi.fn(async (executable: string) => {
      await waiting;
      return resultFor(executable);
    });
    const service = new ProviderAuthService({ runCommand });
    service.reportRuntimeAuthFailure('claude');

    const refresh = service.status({ refresh: true });
    const ordinary = service.status();

    expect(refresh).toBe(ordinary);
    await vi.waitFor(() => expect(runCommand).toHaveBeenCalledTimes(PROBE_ROUND));
    release();
    await expect(ordinary.then(({ providers }) => providers[0])).resolves.toMatchObject({
      provider: 'claude',
      status: 'disconnected',
    });
  });

  it('uses CEZ_CODEX_BIN and CEZ_OPENCODE_BIN for both probe and login commands', async () => {
    process.env.CEZ_CODEX_BIN = '/tools/codex custom';
    process.env.CEZ_OPENCODE_BIN = '/tools/opencode custom';
    const runCommand = runner();
    const service = new ProviderAuthService({ runCommand, platform: 'linux' });

    await service.status();
    expect(runCommand).toHaveBeenCalledWith('/tools/codex custom', ['login', 'status'], 10_000);
    expect(runCommand).toHaveBeenCalledWith('/tools/opencode custom', ['auth', 'list'], 10_000);
    expect(service.loginCommand('codex')).toBe("'/tools/codex custom' login");
    expect(service.loginCommand('opencode')).toBe("'/tools/opencode custom' auth login");
  });

  it('uses CEZ_PI_BIN for the model-availability probe and interactive login', async () => {
    process.env.CEZ_PI_BIN = '/tools/pi custom';
    const runCommand = runner((executable) =>
      executable === '/tools/pi custom' ? connectedResults.pi! : resultFor(executable));
    const service = new ProviderAuthService({ runCommand, platform: 'linux' });

    await service.status();
    expect(runCommand).toHaveBeenCalledWith('/tools/pi custom', ['--list-models'], 10_000);
    expect(service.loginCommand('pi')).toBe("'/tools/pi custom' /login");
  });

  it('uses the documented CEZ_CLAUDE_BIN override for both probe and login commands', async () => {
    process.env.CEZ_CLAUDE_BIN = '/tools/claude custom';
    const runCommand = runner((executable) =>
      executable === '/tools/claude custom' ? connectedResults.claude! : resultFor(executable));
    const service = new ProviderAuthService({ runCommand, platform: 'linux' });

    await service.status();
    expect(runCommand).toHaveBeenCalledWith('/tools/claude custom', ['auth', 'status', '--json'], 10_000);
    expect(service.loginCommand('claude')).toBe("'/tools/claude custom' auth login");
  });

  it('renders POSIX and Windows login commands safely for executable special characters', () => {
    process.env.CEZ_CODEX_BIN = "a path/'codex'";
    process.env.CEZ_OPENCODE_BIN = 'C:\\Program Files\\op%en&co!de".exe';

    expect(new ProviderAuthService({ platform: 'linux' }).loginCommand('codex'))
      .toBe("'a path/'\\''codex'\\''' login");
    expect(new ProviderAuthService({ platform: 'win32' }).loginCommand('opencode'))
      .toBe('"C:\\Program Files\\op^%en^&co^!de^".exe" auth login');
  });

  it('reports every provider connected in CEZ_DRY_RUN without executing a command', async () => {
    process.env.CEZ_DRY_RUN = '1';
    const runCommand = runner();
    const service = new ProviderAuthService({ runCommand });

    await expect(service.status()).resolves.toEqual({
      providers: [
        { provider: 'claude', status: 'connected' },
        { provider: 'codex', status: 'connected' },
        { provider: 'opencode', status: 'connected' },
        { provider: 'cursor', status: 'connected' },
        { provider: 'pi', status: 'connected' },
        { provider: 'junie', status: 'connected' },
        { provider: 'copilot', status: 'connected' },
        { provider: 'kilo', status: 'connected' },
        { provider: 'gemini', status: 'connected' },
        { provider: 'antigravity', status: 'connected' },
        { provider: 'http', status: 'connected' },
      ],
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  describe('per-account status (spec 2026-07-29-agent-profiles)', () => {
    it('probes an account with its own config dir in the environment', async () => {
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const row = await service.profileStatus('claude', { id: 'work', configDir: '/home/u/.claude-klaudiusz' });

      expect(row).toEqual({ provider: 'claude', status: 'connected', profileId: 'work' });
      expect(runCommand).toHaveBeenCalledWith('claude', ['auth', 'status', '--json'], 10_000, {
        CLAUDE_CONFIG_DIR: '/home/u/.claude-klaudiusz',
      });
    });

    it('keeps `status()` byte-identical — the default probe still gets THREE arguments', async () => {
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });
      await service.status();
      // `runCommand` is an injected seam; handing every existing implementation a trailing
      // `undefined` would change the zero-config path for no gain.
      expect(runCommand).toHaveBeenCalledWith('claude', ['auth', 'status', '--json'], 10_000);
    });

    it('never carries `profileId` on the rows `status()` builds', async () => {
      const service = new ProviderAuthService({ runCommand: runner() });
      const { providers } = await service.status();
      expect(providers.every((row) => !('profileId' in row))).toBe(true);
    });

    it('keeps peeking after the probe window closes — a peek blocks nothing', async () => {
      // The window exists to stop a stale NEGATIVE from blocking a run. A peek only fills in a dot
      // on a settings page, so applying it there made the cache expire in 5s on any machine with
      // one provider logged out (most of them) and put the shell-out back on the page load.
      let now = 1_000;
      let spawns = 0;
      const service = new ProviderAuthService({
        now: () => now,
        runCommand: async (executable) => {
          spawns += 1;
          return executable === 'claude'
            ? { stdout: '{"loggedIn":false}', stderr: '', exitCode: 1 }
            : resultFor(executable);
        },
      });

      await service.status();
      await service.profileStatus('claude', { id: 'work', configDir: '/work' });
      const before = spawns;
      now += 60 * 60_000; // an hour later

      expect(service.peekStatus()?.providers).toHaveLength(PROVIDER_IDS.length);
      expect(service.peekProfileStatus('claude', 'work')).toBeDefined();
      expect(spawns).toBe(before); // …and still nothing spawned
    });

    it('peeks the cache without probing, and reports a miss rather than spawning', async () => {
      // The accounts listing reads through these: a peek that spawned would put a CLI shell-out
      // back on a page load, which is the regression this pair exists to prevent.
      let spawns = 0;
      const service = new ProviderAuthService({
        runCommand: async (executable) => {
          spawns += 1;
          return resultFor(executable);
        },
      });

      expect(service.peekStatus()).toBeUndefined();
      expect(service.peekProfileStatus('claude', 'work')).toBeUndefined();
      expect(spawns).toBe(0);

      await service.status();
      await service.profileStatus('claude', { id: 'work', configDir: '/work' });
      const before = spawns;
      expect(service.peekStatus()?.providers).toHaveLength(PROVIDER_IDS.length);
      expect(service.peekProfileStatus('claude', 'work')?.profileId).toBe('work');
      expect(spawns).toBe(before);
    });

    it('caches per (provider, account) — two logins never read each other\'s answer', async () => {
      let calls = 0;
      const runCommand: RunProviderCommand = vi.fn(async (executable, args, _timeout, env) => {
        calls += 1;
        // The work account's CLI cannot spawn; the personal one can.
        if (env?.CLAUDE_CONFIG_DIR === '/work') throw new Error('spawn failure');
        return resultFor(executable);
      });
      const service = new ProviderAuthService({ runCommand });

      const work = await service.profileStatus('claude', { id: 'work', configDir: '/work' });
      const client = await service.profileStatus('claude', { id: 'client', configDir: '/client' });
      expect(work.status).toBe('unknown');
      expect(client.status).toBe('connected');
      expect(calls).toBe(2);

      // Both answers are cached independently, on the same asymmetric lifetime `status()` uses
      // (`cacheTtlFor`) — not a flat 5s window; that spelling is what this file's own
      // "cache lifetime is asymmetric on purpose" block replaced.
      expect((await service.profileStatus('claude', { id: 'work', configDir: '/work' })).status)
        .toBe('unknown');
      expect(calls).toBe(2);

      service.forgetProfileStatus();
      await service.profileStatus('claude', { id: 'work', configDir: '/work' });
      expect(calls).toBe(3);
    });

    it('forgets ONE account, leaving the rest of the warmed cache alone', async () => {
      // This cache is pre-warmed at boot and meant to survive, so evicting every account because
      // one was repointed (or re-checked) would throw away knowledge that is still true.
      let calls = 0;
      const service = new ProviderAuthService({
        runCommand: async () => {
          calls += 1;
          return connectedResults.claude!;
        },
      });
      await service.profileStatus('claude', { id: 'work', configDir: '/work' });
      await service.profileStatus('claude', { id: 'client', configDir: '/client' });
      await service.profileStatus('codex', { id: 'work', configDir: '/codex-klaudiusz' });
      expect(calls).toBe(3);

      service.forgetProfileStatus('claude', 'work');
      // Same id under a different provider is a different account, and is untouched.
      expect(service.peekProfileStatus('codex', 'work')).toBeDefined();
      expect(service.peekProfileStatus('claude', 'client')).toBeDefined();
      expect(service.peekProfileStatus('claude', 'work')).toBeUndefined();

      await service.profileStatus('claude', { id: 'client', configDir: '/client' });
      await service.profileStatus('codex', { id: 'work', configDir: '/codex-klaudiusz' });
      expect(calls).toBe(3);
      await service.profileStatus('claude', { id: 'work', configDir: '/work' });
      expect(calls).toBe(4);
    });

    it('answers connected per account in CEZ_DRY_RUN without executing a command', async () => {
      process.env.CEZ_DRY_RUN = '1';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });
      await expect(service.profileStatus('claude', { id: 'work', configDir: '/work' })).resolves.toEqual({
        provider: 'claude',
        status: 'connected',
        profileId: 'work',
      });
      expect(runCommand).not.toHaveBeenCalled();
    });

    it('aims the login command at the account, and refuses a dir it cannot embed safely', () => {
      const posix = new ProviderAuthService({ platform: 'linux' });
      expect(posix.loginCommand('claude', '/home/u/.claude-klaudiusz'))
        .toBe("export CLAUDE_CONFIG_DIR='/home/u/.claude-klaudiusz'; 'claude' auth login");
      expect(posix.loginCommand('claude', null)).toBe("'claude' auth login");

      const win = new ProviderAuthService({ platform: 'win32' });
      expect(win.loginCommand('codex', 'C:\\codex-klaudiusz'))
        .toBe('set "CODEX_HOME=C:\\codex-klaudiusz" && "codex" login');
      // Fail closed rather than sign the user into a different account than the one they clicked.
      expect(win.loginCommand('codex', 'C:\\bad"dir')).toBeNull();
    });

    it('adds nothing for OpenCode, whose credentials do not follow its config dir', () => {
      expect(new ProviderAuthService({ platform: 'linux' }).loginCommand('opencode', '/oc-work'))
        .toBe("'opencode' auth login");
    });
  });

  describe('API key authentication (precheck)', () => {
    const savedEnv = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY,
      CURSOR_API_KEY: process.env.CURSOR_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      GROQ_API_KEY: process.env.GROQ_API_KEY,
      CEZ_HTTP_AGENT_CONFIG: process.env.CEZ_HTTP_AGENT_CONFIG,
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
      AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
      CURSOR_BASE_URL: process.env.CURSOR_BASE_URL,
      GOOGLE_API_BASE_URL: process.env.GOOGLE_API_BASE_URL,
      OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
      GROQ_BASE_URL: process.env.GROQ_BASE_URL,
      MISTRAL_BASE_URL: process.env.MISTRAL_BASE_URL,
    };

    beforeEach(() => {
      for (const key of Object.keys(savedEnv)) {
        delete process.env[key];
      }
    });

    afterEach(() => {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it('detects Claude via ANTHROPIC_API_KEY without calling CLI', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test123';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      const claude = providers.find((p) => p.provider === 'claude');
      expect(claude?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith(expect.stringContaining('claude'), expect.anything(), expect.anything());
    });

    it('detects Codex via OPENAI_API_KEY without calling CLI', async () => {
      process.env.OPENAI_API_KEY = 'sk-test123';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      const codex = providers.find((p) => p.provider === 'codex');
      expect(codex?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith(expect.stringContaining('codex'), expect.anything(), expect.anything());
    });

    it('detects Codex via AZURE_OPENAI_API_KEY without calling CLI', async () => {
      process.env.AZURE_OPENAI_API_KEY = 'azure-test123';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      const codex = providers.find((p) => p.provider === 'codex');
      expect(codex?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith(expect.stringContaining('codex'), expect.anything(), expect.anything());
    });

    it('detects OpenCode via any supported provider API key', async () => {
      process.env.GROQ_API_KEY = 'gsk-test123';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      const opencode = providers.find((p) => p.provider === 'opencode');
      expect(opencode?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith(expect.stringContaining('opencode'), expect.anything(), expect.anything());
    });

    it('detects Kilo via any supported provider API key', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test123';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      const kilo = providers.find((p) => p.provider === 'kilo');
      expect(kilo?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith(expect.stringContaining('kilo'), expect.anything(), expect.anything());
    });

    it('detects pi via any supported provider API key', async () => {
      process.env.OPENAI_API_KEY = 'sk-test123';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      const pi = providers.find((p) => p.provider === 'pi');
      expect(pi?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith('pi', expect.anything(), expect.anything());
    });

    it('detects Gemini via GEMINI_API_KEY without calling CLI', async () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      const gemini = providers.find((p) => p.provider === 'gemini');
      expect(gemini?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith(expect.stringContaining('gemini'), expect.anything(), expect.anything());
    });

    it('detects Gemini via GOOGLE_GENERATIVE_AI_API_KEY without calling CLI', async () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-google-key';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      const gemini = providers.find((p) => p.provider === 'gemini');
      expect(gemini?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith(expect.stringContaining('gemini'), expect.anything(), expect.anything());
    });

    it('detects Antigravity via GOOGLE_GENERATIVE_AI_API_KEY without calling CLI', async () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-google-key';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      const antigravity = providers.find((p) => p.provider === 'antigravity');
      expect(antigravity?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith(expect.stringContaining('agy'), expect.anything(), expect.anything());
    });

    it('detects HTTP agent via CEZ_HTTP_AGENT_CONFIG', async () => {
      process.env.CEZ_HTTP_AGENT_CONFIG = '{"endpoint":"https://api.example.com/v1/chat/completions","apiKey":"test"}';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      const http = providers.find((p) => p.provider === 'http');
      expect(http?.status).toBe('connected');
    });

    it('shows HTTP agent as disconnected when CEZ_HTTP_AGENT_CONFIG is missing', async () => {
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      const http = providers.find((p) => p.provider === 'http');
      expect(http?.status).toBe('disconnected');
    });

    it('falls back to the CLI check when the API key is empty', async () => {
      process.env.ANTHROPIC_API_KEY = '   '; // whitespace only
      const runCommand = runner((executable) => executable === 'claude'
        ? { stdout: '{"loggedIn":false}', stderr: '', exitCode: 1 }
        : resultFor(executable));
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      const claude = providers.find((p) => p.provider === 'claude');
      expect(claude?.status).toBe('disconnected');
      expect(runCommand).toHaveBeenCalledWith('claude', ['auth', 'status', '--json'], 10_000);
    });

    it('supports multiple providers with API keys simultaneously', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.OPENAI_API_KEY = 'sk-test';
      process.env.GROQ_API_KEY = 'gsk-test';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      expect(providers.find((p) => p.provider === 'claude')?.status).toBe('connected');
      expect(providers.find((p) => p.provider === 'codex')?.status).toBe('connected');
      expect(providers.find((p) => p.provider === 'opencode')?.status).toBe('connected');
      expect(providers.find((p) => p.provider === 'kilo')?.status).toBe('connected');
      expect(providers.find((p) => p.provider === 'pi')?.status).toBe('connected');
    });

    it('detects Claude via ANTHROPIC_BASE_URL without calling CLI', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://custom-endpoint.com';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      const claude = providers.find((p) => p.provider === 'claude');
      expect(claude?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith(expect.stringContaining('claude'), expect.anything(), expect.anything());
    });

    it('detects Codex via OPENAI_BASE_URL without calling CLI', async () => {
      process.env.OPENAI_BASE_URL = 'https://custom-endpoint.com';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      const codex = providers.find((p) => p.provider === 'codex');
      expect(codex?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith(expect.stringContaining('codex'), expect.anything(), expect.anything());
    });

    it('detects Codex via AZURE_OPENAI_ENDPOINT without calling CLI', async () => {
      process.env.AZURE_OPENAI_ENDPOINT = 'https://custom.openai.azure.com';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      const codex = providers.find((p) => p.provider === 'codex');
      expect(codex?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith(expect.stringContaining('codex'), expect.anything(), expect.anything());
    });

    it('detects OpenCode via base URL without calling CLI', async () => {
      process.env.OPENROUTER_BASE_URL = 'https://custom-openrouter.com';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      const opencode = providers.find((p) => p.provider === 'opencode');
      expect(opencode?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith(expect.stringContaining('opencode'), expect.anything(), expect.anything());
    });

    it('detects Cursor via CURSOR_BASE_URL without calling CLI', async () => {
      process.env.CURSOR_BASE_URL = 'https://custom-cursor.com';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      const cursor = providers.find((p) => p.provider === 'cursor');
      expect(cursor?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith(expect.stringContaining('agent'), expect.anything(), expect.anything());
    });

    it('detects Gemini via GOOGLE_API_BASE_URL without calling CLI', async () => {
      process.env.GOOGLE_API_BASE_URL = 'https://custom-google-api.com';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      const gemini = providers.find((p) => p.provider === 'gemini');
      expect(gemini?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith(expect.stringContaining('gemini'), expect.anything(), expect.anything());
    });

    it('supports API keys and custom endpoints simultaneously', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://custom1.com';
      process.env.OPENAI_API_KEY = 'sk-test';
      process.env.GROQ_BASE_URL = 'https://custom2.com';
      const runCommand = runner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      expect(providers.find((p) => p.provider === 'claude')?.status).toBe('connected');
      expect(providers.find((p) => p.provider === 'codex')?.status).toBe('connected');
      expect(providers.find((p) => p.provider === 'opencode')?.status).toBe('connected');
      expect(providers.find((p) => p.provider === 'kilo')?.status).toBe('connected');
      expect(providers.find((p) => p.provider === 'pi')?.status).toBe('connected');
    });
  });

  describe("custom endpoint in the agent's OWN config file (precheck)", () => {
    // A provider switcher such as cc-switch never exports an endpoint — it writes it into the
    // agent's own config file (`~/.claude/settings.json`, `~/.codex/config.toml`) and the CLI then
    // uses it with nothing in the environment. For Codex the CLI even answers "Not logged in" for
    // such a provider, so cezar called a working setup disconnected. See `provider-file-config.ts`.
    const sandboxes: string[] = [];
    const savedDirs = {
      CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
      CODEX_HOME: process.env.CODEX_HOME,
    };

    const sandbox = (): string => {
      const dir = mkdtempSync(join(tmpdir(), 'cez-provider-file-'));
      sandboxes.push(dir);
      return dir;
    };

    const writeCodexConfig = (home: string, toml: string): void => {
      mkdirSync(home, { recursive: true });
      writeFileSync(join(home, 'config.toml'), toml, 'utf8');
    };

    const writeClaudeSettings = (home: string, settings: string): void => {
      mkdirSync(home, { recursive: true });
      writeFileSync(join(home, 'settings.json'), settings, 'utf8');
    };

    /** The CLI answers for Codex exactly as a custom-provider setup makes it answer: "Not logged
     *  in" on exit 1 — a confident negative the config file has to override. */
    const codexCliSaysNotLoggedIn = runner((executable) => executable.includes('codex')
      ? { stdout: 'Not logged in', stderr: '', exitCode: 1 }
      : resultFor(executable));

    afterEach(() => {
      for (const [key, value] of Object.entries(savedDirs)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    it('reports Codex connected from a cc-switch config.toml, without calling the CLI', async () => {
      const home = sandbox();
      writeCodexConfig(home, [
        'model_provider = "custom"',
        'model = "deepseek-v4.1-flash"',
        '',
        '[model_providers.custom]',
        'name = "My Codex"',
        'base_url = "https://a6api.com/v1"',
        'wire_api = "responses"',
        'requires_openai_auth = false',
        'experimental_bearer_token = "sk-test"',
      ].join('\n'));
      process.env.CODEX_HOME = home;
      const runCommand = codexCliSaysNotLoggedIn;
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      expect(providers.find((p) => p.provider === 'codex')?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith(
        expect.stringContaining('codex'), expect.anything(), expect.anything());
    });

    it('accepts a custom provider that carries an inline bearer token', async () => {
      const home = sandbox();
      writeCodexConfig(home, [
        'model_provider = "custom"',
        '',
        '[model_providers.custom]',
        'base_url = "https://a6api.com/v1"',
        'experimental_bearer_token = "sk-test"',
      ].join('\n'));
      process.env.CODEX_HOME = home;
      const service = new ProviderAuthService({ runCommand: codexCliSaysNotLoggedIn });

      const { providers } = await service.status();
      expect(providers.find((p) => p.provider === 'codex')?.status).toBe('connected');
    });

    it('accepts a custom provider whose env_key names a variable that is set', async () => {
      const home = sandbox();
      writeCodexConfig(home, [
        'model_provider = "custom"',
        '',
        '[model_providers.custom]',
        'base_url = "https://a6api.com/v1"',
        'env_key = "CEZ_TEST_PROVIDER_KEY"',
      ].join('\n'));
      process.env.CODEX_HOME = home;
      process.env.CEZ_TEST_PROVIDER_KEY = 'sk-test';
      try {
        const service = new ProviderAuthService({ runCommand: codexCliSaysNotLoggedIn });
        const { providers } = await service.status();
        expect(providers.find((p) => p.provider === 'codex')?.status).toBe('connected');
      } finally {
        delete process.env.CEZ_TEST_PROVIDER_KEY;
      }
    });

    it('falls through to the CLI for a bare base_url, whose own answer decides', async () => {
      // The file alone must not CLAIM connected (the built-in `openai` provider keeps its login
      // even when pointed at another host), but the fall-through CLI probe answers from
      // installation, not from the vendor login — so the row is connected either way.
      const home = sandbox();
      writeCodexConfig(home, [
        'model_provider = "custom"',
        '',
        '[model_providers.custom]',
        'base_url = "https://api.openai.com/v1"',
      ].join('\n'));
      process.env.CODEX_HOME = home;
      const runCommand = codexCliSaysNotLoggedIn;
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      expect(providers.find((p) => p.provider === 'codex')?.status).toBe('disconnected');
      expect(runCommand).toHaveBeenCalledWith('codex', ['login', 'status'], 10_000);
    });

    it('falls through to the CLI when config.toml is absent, empty or unparseable', async () => {
      for (const toml of [undefined, '', 'model_provider = "custom"\n[model_providers.custom\n']) {
        const home = sandbox();
        if (toml !== undefined) writeCodexConfig(home, toml);
        process.env.CODEX_HOME = home;
        const runCommand = codexCliSaysNotLoggedIn;
        const service = new ProviderAuthService({ runCommand });

        const { providers } = await service.status();
        expect(providers.find((p) => p.provider === 'codex')?.status).toBe('disconnected');
        expect(runCommand).toHaveBeenCalledWith('codex', ['login', 'status'], 10_000);
      }
    });

    it('reports Claude connected from a cc-switch settings.json env block, without the CLI', async () => {
      const home = sandbox();
      writeClaudeSettings(home, JSON.stringify({
        env: { ANTHROPIC_BASE_URL: 'https://a6api.com', ANTHROPIC_AUTH_TOKEN: 'sk-test' },
      }));
      process.env.CLAUDE_CONFIG_DIR = home;
      const runCommand = runner((executable) => executable === 'claude'
        ? { stdout: '{"loggedIn":false}', stderr: '', exitCode: 1 }
        : resultFor(executable));
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      expect(providers.find((p) => p.provider === 'claude')?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith(
        expect.stringContaining('claude'), expect.anything(), expect.anything());
    });

    it('accepts a Claude token with no base URL — the official endpoint, no login needed', async () => {
      const home = sandbox();
      writeClaudeSettings(home, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'sk-test' } }));
      process.env.CLAUDE_CONFIG_DIR = home;
      const service = new ProviderAuthService({
        runCommand: runner((executable) => executable === 'claude'
          ? { stdout: '{"loggedIn":false}', stderr: '', exitCode: 1 }
          : resultFor(executable)),
      });

      const { providers } = await service.status();
      expect(providers.find((p) => p.provider === 'claude')?.status).toBe('connected');
    });

    it('falls through to the CLI for a settings.json with no env block or a bad one', async () => {
      for (const settings of ['{"model":"opus"}', '{ not json', '{"env":{}}']) {
        const home = sandbox();
        writeClaudeSettings(home, settings);
        process.env.CLAUDE_CONFIG_DIR = home;
        const runCommand = runner((executable) => executable === 'claude'
          ? { stdout: '{"loggedIn":false}', stderr: '', exitCode: 1 }
          : resultFor(executable));
        const service = new ProviderAuthService({ runCommand });

        const { providers } = await service.status();
        expect(providers.find((p) => p.provider === 'claude')?.status).toBe('disconnected');
        expect(runCommand).toHaveBeenCalledWith('claude', ['auth', 'status', '--json'], 10_000);
      }
    });

    it("reads a named account's OWN config dir, never the discovered default's", async () => {
      // The #811 trap, one layer down: the file lives per account, so a precheck that resolved the
      // default home for every row would report the default account's endpoint on another's card.
      const defaultHome = sandbox();
      const profileHome = sandbox();
      writeClaudeSettings(profileHome, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://a6api.com' } }));
      process.env.CLAUDE_CONFIG_DIR = defaultHome;
      const runCommand = runner((executable) => executable === 'claude'
        ? { stdout: '{"loggedIn":false}', stderr: '', exitCode: 1 }
        : resultFor(executable));
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      expect(providers.find((p) => p.provider === 'claude')?.status).toBe('disconnected');
      // The default row fell through to the CLI — it did not read the named account's file.
      expect(runCommand).toHaveBeenCalledWith('claude', ['auth', 'status', '--json'], 10_000);
      const row = await service.profileStatus('claude', { id: 'work', configDir: profileHome });
      expect(row).toEqual({ provider: 'claude', status: 'connected', profileId: 'work' });
    });
  });

  describe('Gemini and Antigravity stored logins (precheck)', () => {
    // Neither CLI exposes an auth-status subcommand — `gemini --version` (0.61.0) and `agy
    // --version` (1.3.0) print a version and nothing else — so cezar's probe could only ever
    // answer 'unknown' for them, and the run gate (`unavailableProviderMessage`) blocks a run
    // whose provider is not 'connected'. The stored login under `~/.gemini` is the only signal
    // that exists. Neither CLI honours a relocation variable, so the home is HOME-derived and
    // this suite pins HOME to a sandbox (`vitest.setup.ts`) — otherwise the developer's real
    // `~/.gemini` would answer for every fixture.
    const sandboxes: string[] = [];
    const savedEnv = {
      CEZ_GEMINI_BIN: process.env.CEZ_GEMINI_BIN,
      CEZ_ANTIGRAVITY_BIN: process.env.CEZ_ANTIGRAVITY_BIN,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
    };

    const sandboxHome = (): string => {
      const dir = mkdtempSync(join(tmpdir(), 'cez-gemini-home-'));
      sandboxes.push(dir);
      return dir;
    };

    const writeGeminiFile = (home: string, relative: string, body: string): void => {
      const path = join(home, '.gemini', relative);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body, 'utf8');
    };

    /** The one probe both CLIs actually answer: a bare version, no auth signal at all. A FACTORY,
     *  not a shared `vi.fn()` — the call log accumulates across a shared mock, so a later case
     *  would "see" the previous case's CLI call and fail an assertion about its own. */
    const versionOnlyRunner = (): RunProviderCommand => runner((executable) =>
      executable === 'gemini' || executable === 'agy'
        ? { stdout: '0.61.0', stderr: '', exitCode: 0 }
        : resultFor(executable));

    beforeEach(() => {
      process.env.CEZ_GEMINI_BIN = 'gemini';
      process.env.CEZ_ANTIGRAVITY_BIN = 'agy';
    });

    afterEach(() => {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    it('reports Gemini connected from its stored OAuth login, without calling the CLI', async () => {
      const home = sandboxHome();
      writeGeminiFile(home, 'oauth_creds.json', JSON.stringify({
        access_token: 'ya29.test',
        refresh_token: '1//test',
        scope: 'https://www.googleapis.com/auth/cloud-platform',
      }));
      process.env.HOME = home;
      const runCommand = versionOnlyRunner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      expect(providers.find((p) => p.provider === 'gemini')?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith('gemini', expect.anything(), expect.anything());
    });

    it('accepts a Gemini login recorded only in google_accounts.json', async () => {
      // A login can leave the address behind without the token file (or with it already rotated
      // out); `active` is a sign-in in its own right.
      const home = sandboxHome();
      writeGeminiFile(home, 'google_accounts.json', JSON.stringify({ active: 'me@example.com', old: [] }));
      process.env.HOME = home;
      const service = new ProviderAuthService({ runCommand: versionOnlyRunner() });

      const { providers } = await service.status();
      expect(providers.find((p) => p.provider === 'gemini')?.status).toBe('connected');
    });

    it('reports Antigravity connected from its stored OAuth token, without calling the CLI', async () => {
      const home = sandboxHome();
      writeGeminiFile(home, 'antigravity-cli/antigravity-oauth-token', JSON.stringify({
        auth_method: 'oauth',
        token: 'ya29.test',
        id_token: 'eyJ.test',
      }));
      process.env.HOME = home;
      const runCommand = versionOnlyRunner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      expect(providers.find((p) => p.provider === 'antigravity')?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith('agy', expect.anything(), expect.anything());
    });

    it('falls through to the CLI for an absent, empty or unparseable stored login', async () => {
      for (const [relative, body] of [
        ['oauth_creds.json', null],
        ['oauth_creds.json', '{}'],
        ['oauth_creds.json', '{ not json'],
        ['oauth_creds.json', JSON.stringify({ scope: 'x' })],
      ] as const) {
        const home = sandboxHome();
        if (body !== null) writeGeminiFile(home, relative, body);
        process.env.HOME = home;
        const runCommand = versionOnlyRunner();
        const service = new ProviderAuthService({ runCommand });

        const { providers } = await service.status();
        // The bare version proves the binary is installed, which is all the probe checks — the
        // credential file must not manufacture a 'connected' from a shape it cannot read, but the
        // CLI fall-through reports connected anyway.
        expect(providers.find((p) => p.provider === 'gemini')?.status).toBe('connected');
        expect(runCommand).toHaveBeenCalledWith('gemini', ['--version'], 10_000);
      }
    });

    it('does not let an Antigravity login claim Gemini, nor the reverse', async () => {
      // The two products share `~/.gemini`, so this pins that each reads only its OWN credential:
      // Gemini falls through to its CLI (proving its file read found nothing), while Antigravity
      // answers from its file without spawning at all.
      const home = sandboxHome();
      writeGeminiFile(home, 'antigravity-cli/antigravity-oauth-token', JSON.stringify({ token: 'ya29.test' }));
      process.env.HOME = home;
      const runCommand = versionOnlyRunner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      expect(providers.find((p) => p.provider === 'gemini')?.status).toBe('connected');
      expect(runCommand).toHaveBeenCalledWith('gemini', ['--version'], 10_000);
      expect(providers.find((p) => p.provider === 'antigravity')?.status).toBe('connected');
      expect(runCommand).not.toHaveBeenCalledWith('agy', expect.anything(), expect.anything());
    });

    it('falls through for Antigravity when its token file carries no credential', async () => {
      const home = sandboxHome();
      writeGeminiFile(home, 'antigravity-cli/antigravity-oauth-token', JSON.stringify({ auth_method: 'oauth' }));
      process.env.HOME = home;
      const runCommand = versionOnlyRunner();
      const service = new ProviderAuthService({ runCommand });

      const { providers } = await service.status();
      expect(providers.find((p) => p.provider === 'antigravity')?.status).toBe('connected');
      expect(runCommand).toHaveBeenCalledWith('agy', ['--version'], 10_000);
    });
  });
});

describe('inconclusive probe reports', () => {
  const codexOnly = (result: ProviderCommandResult | (() => never)): RunProviderCommand => async (executable, args) => {
    if (args[0] === '--version') return { stdout: 'codex-cli 0.46.0\n', stderr: '', exitCode: 0 };
    if (executable === 'codex') {
      if (typeof result === 'function') return result();
      return result;
    }
    return { stdout: '', stderr: '', exitCode: null, errorCode: 'ENOENT' };
  };

  const reasonsFor = async (result: ProviderCommandResult | (() => never)) => {
    const onInconclusive = vi.fn();
    const service = new ProviderAuthService({ runCommand: codexOnly(result), onInconclusive });
    const status = await service.status({ refresh: true });
    expect(status.providers.find((row) => row.provider === 'codex')?.status).toBe('unknown');
    return onInconclusive.mock.calls.map(([probe]) => probe);
  };

  it('names the reason, never the output', async () => {
    const [probe] = await reasonsFor({ stdout: 'me@example.com is something new', stderr: 'tok', exitCode: 0 });
    expect(probe).toMatchObject({
      provider: 'codex',
      reason: 'unrecognized_output',
      profile: 'default',
      binSource: 'path',
      binExt: 'none',
      errorCode: null,
      exitCode: 0,
      stdoutBytes: 31,
      stdoutJson: false,
      stderrBytes: 3,
    });
    expect(JSON.stringify(probe)).not.toContain('example.com');
    expect(await probe.cliVersion()).toBe('0.46.0');
  });

  // Telemetry 35838a52: `claude auth status --json` exited 0 with no output at all, once.
  it('asks again when the CLI exits 0 having said nothing', async () => {
    const onInconclusive = vi.fn();
    let claudeCalls = 0;
    const runCommand: RunProviderCommand = async (executable) => {
      if (executable !== 'claude') return { stdout: '', stderr: '', exitCode: null, errorCode: 'ENOENT' };
      claudeCalls += 1;
      return claudeCalls === 1
        ? { stdout: '', stderr: '', exitCode: 0 }
        : { stdout: '{"loggedIn":true}', stderr: '', exitCode: 0 };
    };
    vi.stubEnv('CEZ_CLAUDE_BIN', 'claude');
    try {
      const service = new ProviderAuthService({ runCommand, onInconclusive });
      const status = await service.status({ refresh: true });
      expect(status.providers.find((row) => row.provider === 'claude')?.status).toBe('connected');
      expect(claudeCalls).toBe(2);
      expect(onInconclusive).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('asks only once more when the CLI stays silent', async () => {
    const runCommand = vi.fn(codexOnly({ stdout: '', stderr: '', exitCode: 0 }));
    const onInconclusive = vi.fn();
    const service = new ProviderAuthService({ runCommand, onInconclusive });
    await service.status({ refresh: true });
    expect(runCommand.mock.calls.filter(([executable]) => executable === 'codex')).toHaveLength(2);
    expect(onInconclusive.mock.calls[0]?.[0]).toMatchObject({ provider: 'codex', reason: 'unrecognized_output' });
  });

  // Telemetry ce0c5d1f: Ctrl-C reached the probe too, `opencode` exited 130 and was reported.
  it('asks again when a signal interrupted the CLI', async () => {
    let codexCalls = 0;
    const onInconclusive = vi.fn();
    const service = new ProviderAuthService({
      runCommand: async (executable) => {
        if (executable !== 'codex') return { stdout: '', stderr: '', exitCode: null, errorCode: 'ENOENT' };
        codexCalls += 1;
        return codexCalls === 1 ? { stdout: '', stderr: '', exitCode: 130 } : connectedResults.codex!;
      },
      onInconclusive,
    });
    const status = await service.status({ refresh: true });
    expect(status.providers.find((row) => row.provider === 'codex')?.status).toBe('connected');
    expect(codexCalls).toBe(2);
    expect(onInconclusive).not.toHaveBeenCalled();
  });

  it('never reports a probe that stays interrupted', async () => {
    for (const result of [
      { stdout: '', stderr: '', exitCode: 130 },
      { stdout: '', stderr: '', exitCode: 143 },
      { stdout: '', stderr: '', exitCode: null, signal: 'SIGINT' },
    ]) {
      const runCommand = vi.fn(codexOnly(result));
      expect(await reasonsFor(result)).toEqual([]);
      const service = new ProviderAuthService({ runCommand });
      const row = (await service.status({ refresh: true })).providers.find((p) => p.provider === 'codex');
      expect(row).toMatchObject({ status: 'unknown', hint: expect.stringContaining('interrupted') });
      expect(runCommand.mock.calls.filter(([executable]) => executable === 'codex')).toHaveLength(2);
    }
  });

  // Telemetry e316b141: claude and codex timed out together on a busy Windows host, then both
  // answered `--version` at once — a stall from the concurrent burst, not a CLI defect.
  it('asks a timed-out CLI once more with a longer budget', async () => {
    const timeouts: number[] = [];
    const onInconclusive = vi.fn();
    const service = new ProviderAuthService({
      runCommand: async (executable, _args, timeoutMs) => {
        if (executable !== 'codex') return { stdout: '', stderr: '', exitCode: null, errorCode: 'ENOENT' };
        timeouts.push(timeoutMs);
        return timeouts.length === 1
          ? { stdout: '', stderr: '', exitCode: null, timedOut: true }
          : connectedResults.codex!;
      },
      onInconclusive,
    });
    const status = await service.status({ refresh: true });
    expect(status.providers.find((row) => row.provider === 'codex')?.status).toBe('connected');
    expect(timeouts).toEqual([10_000, 30_000]);
    expect(onInconclusive).not.toHaveBeenCalled();
  });

  it('reports a timeout only once the longer second ask hung too', async () => {
    const timeout = { stdout: '', stderr: '', exitCode: null, timedOut: true };
    const runCommand = vi.fn(codexOnly(timeout));
    const onInconclusive = vi.fn();
    const service = new ProviderAuthService({ runCommand, onInconclusive });
    const row = (await service.status({ refresh: true })).providers.find((p) => p.provider === 'codex');
    expect(row).toMatchObject({ status: 'unknown', hint: expect.stringContaining('timed out') });
    expect(runCommand.mock.calls.filter(([executable, args]) => executable === 'codex' && args[0] !== '--version')
      .map(([, , timeoutMs]) => timeoutMs)).toEqual([10_000, 30_000]);
    expect(onInconclusive.mock.calls[0]?.[0]).toMatchObject({ reason: 'timeout' });
  });

  // Telemetry b28d2993: the same burst as e316b141 hit claude, which had been connected for days;
  // the hang turned it `unknown` and the action gate refused runs against a login that was fine.
  describe('a probe that hangs after a connected answer', () => {
    const hang: ProviderCommandResult = { stdout: '', stderr: '', exitCode: null, timedOut: true };
    const scripted = (answers: ProviderCommandResult[]): RunProviderCommand => async (executable, args) => {
      if (args[0] === '--version') return { stdout: 'codex-cli 0.46.0\n', stderr: '', exitCode: 0 };
      if (executable !== 'codex') return { stdout: '', stderr: '', exitCode: null, errorCode: 'ENOENT' };
      return answers.shift() ?? hang;
    };
    const codexRow = async (service: ProviderAuthService) =>
      (await service.status({ refresh: true })).providers.find((row) => row.provider === 'codex');

    it('keeps the recent connected answer, and still reports the hang', async () => {
      let now = 1_000;
      const onInconclusive = vi.fn();
      const service = new ProviderAuthService({
        runCommand: scripted([connectedResults.codex!]),
        now: () => now,
        onInconclusive,
      });
      expect(await codexRow(service)).toEqual({ provider: 'codex', status: 'connected' });
      now += 20 * 60_000;
      expect(await codexRow(service)).toEqual({ provider: 'codex', status: 'connected' });
      expect(onInconclusive.mock.calls[0]?.[0]).toMatchObject({ provider: 'codex', reason: 'timeout' });
    });

    it('lets the hang show once the connected answer is too old to vouch for the login', async () => {
      let now = 1_000;
      const service = new ProviderAuthService({ runCommand: scripted([connectedResults.codex!]), now: () => now });
      await codexRow(service);
      now += 31 * 60_000;
      expect(await codexRow(service)).toMatchObject({ status: 'unknown', hint: expect.stringContaining('timed out') });
    });

    it('never bridges past an answer the CLI actually gave', async () => {
      const service = new ProviderAuthService({
        runCommand: scripted([connectedResults.codex!, { stdout: 'Not logged in', stderr: '', exitCode: 1 }]),
        now: () => 1_000,
      });
      await codexRow(service);
      expect((await codexRow(service))?.status).toBe('disconnected');
      expect(await codexRow(service)).toMatchObject({ status: 'unknown', hint: expect.stringContaining('timed out') });
    });

    it('never bridges past a runtime rejection', async () => {
      const service = new ProviderAuthService({ runCommand: scripted([connectedResults.codex!]), now: () => 1_000 });
      await codexRow(service);
      const report = service.reportRuntimeAuthFailure('codex');
      service.clearRuntimeAuthFailure('codex', report!.status.authFailureId);
      expect(await codexRow(service)).toMatchObject({ status: 'unknown', hint: expect.stringContaining('timed out') });
    });

    it('bridges a named account only for the dir that answered, and never lifts its latch', async () => {
      const service = new ProviderAuthService({ runCommand: scripted([connectedResults.codex!]), now: () => 1_000 });
      const account = { id: 'work', configDir: '/work' };
      expect((await service.profileStatus('codex', account)).status).toBe('connected');
      service.forgetProfileStatus('codex', 'work');
      service.reportProfileAuthFailure('codex', 'work');
      expect((await service.profileStatus('codex', account)).status).toBe('disconnected');

      const other = new ProviderAuthService({ runCommand: scripted([connectedResults.codex!]), now: () => 1_000 });
      await other.profileStatus('codex', account);
      other.forgetProfileStatus('codex', 'work');
      expect((await other.profileStatus('codex', account)).status).toBe('connected');
      other.forgetProfileStatus('codex', 'work');
      expect((await other.profileStatus('codex', { id: 'work', configDir: '/elsewhere' })).status).toBe('unknown');
    });
  });

  it('tells an unexpected exit, a spawn error, a timeout and a throw apart', async () => {
    expect((await reasonsFor({ stdout: '', stderr: '', exitCode: 3 }))[0]?.reason).toBe('unexpected_exit');
    expect((await reasonsFor({ stdout: '', stderr: '', exitCode: null, errorCode: 'EINVAL' }))[0])
      .toMatchObject({ reason: 'spawn_error', errorCode: 'EINVAL' });
    expect((await reasonsFor({ stdout: '', stderr: '', exitCode: null, errorCode: 'ETIMEDOUT', timedOut: true }))[0]?.reason)
      .toBe('timeout');
    expect((await reasonsFor(() => { throw new Error('boom'); }))[0]?.reason).toBe('spawn_threw');
  });

  // Telemetry a330744e: the thrown error's code reached the report as null.
  it('keeps the code of a spawn that threw, and names the setting for an unrunnable shim', async () => {
    const onInconclusive = vi.fn();
    vi.stubEnv('CEZ_CODEX_BIN', 'C:\\tools\\codex.cmd');
    try {
      const service = new ProviderAuthService({
        runCommand: async (executable) => {
          if (executable !== 'C:\\tools\\codex.cmd') return { stdout: '', stderr: '', exitCode: null, errorCode: 'ENOENT' };
          throw Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' });
        },
        onInconclusive,
      });
      const row = (await service.status({ refresh: true })).providers.find((p) => p.provider === 'codex');
      expect(row).toMatchObject({ status: 'unknown', hint: expect.stringContaining('CEZ_CODEX_BIN') });
      expect(onInconclusive.mock.calls[0]?.[0]).toMatchObject({
        reason: 'spawn_threw',
        errorCode: 'EINVAL',
        binSource: 'override',
        binExt: '.cmd',
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // Telemetry 3626ac13: a `.ps1` override throws with a code other than EINVAL.
  it('names the setting for an unrunnable PowerShell shim too', async () => {
    vi.stubEnv('CEZ_OPENCODE_BIN', 'C:\\tools\\opencode.ps1');
    try {
      const service = new ProviderAuthService({
        runCommand: async (executable) => {
          if (executable !== 'C:\\tools\\opencode.ps1') return { stdout: '', stderr: '', exitCode: null, errorCode: 'ENOENT' };
          throw Object.assign(new Error('spawn UNKNOWN'), { code: 'UNKNOWN' });
        },
      });
      const row = (await service.status({ refresh: true })).providers.find((p) => p.provider === 'opencode');
      expect(row).toMatchObject({ status: 'unknown', hint: expect.stringContaining('CEZ_OPENCODE_BIN') });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // Telemetry 298c2e1f: exit 0, a short non-JSON answer, and no version cezar could read.
  it('names the fix when `copilot` on PATH never started an ACP server', async () => {
    const onInconclusive = vi.fn();
    const service = new ProviderAuthService({
      runCommand: async (executable, args) => {
        if (executable !== 'copilot') return { stdout: '', stderr: '', exitCode: null, errorCode: 'ENOENT' };
        if (args.includes('--version')) {
          expect(args).toEqual(['--no-auto-update', '--version']);
          return { stdout: 'copilot version: v1.34.1\n', stderr: '', exitCode: 0 };
        }
        return { stdout: 'something that is not JSON-RPC\n', stderr: 'warning', exitCode: 0 };
      },
      onInconclusive,
    });
    const row = (await service.status({ refresh: true })).providers.find((p) => p.provider === 'copilot');
    expect(row).toMatchObject({ status: 'unknown', hint: expect.stringContaining('CEZ_COPILOT_BIN') });
    const [probe] = onInconclusive.mock.calls.map(([call]) => call);
    expect(probe).toMatchObject({ provider: 'copilot', reason: 'unrecognized_output' });
    expect(await probe.cliVersion()).toBe('1.34.1');
  });

  // Telemetry f67df9d2: an asdf shim named `pi`, exit 1, nothing on stdout, Python's version on stderr.
  it('reports a version-manager shim with no version behind it as not-installed, not inconclusive', async () => {
    const onInconclusive = vi.fn();
    const asdfMiss = 'No version is set for command pi\n'
      + 'Consider adding one of the following versions in your config file at /work/.tool-versions\n'
      + 'python 3.11.9\n';
    const service = new ProviderAuthService({
      runCommand: async (executable) => executable === 'pi'
        ? { stdout: '', stderr: asdfMiss, exitCode: 1 }
        : { stdout: '', stderr: '', exitCode: null, errorCode: 'ENOENT' },
      onInconclusive,
    });
    const row = (await service.status({ refresh: true })).providers.find((p) => p.provider === 'pi');
    expect(row).toMatchObject({
      status: 'not-installed',
      hint: expect.stringContaining('No version is set for command pi'),
    });
    expect(row?.hint).toContain('CEZ_PI_BIN');
    expect(onInconclusive).not.toHaveBeenCalled();
  });

  // f67df9d2 regressed in 0.16.0: the shim's stderr matched none of #1504's patterns. Whatever its
  // wording, a `pi` that cannot answer `--version` is not a working pi.
  it('reports a `pi` that cannot answer --version as not-installed, whatever its stderr says', async () => {
    const onInconclusive = vi.fn();
    const stderr = 'pi: shim has no active version (wanted python 3.11.9); try `tool install`\n';
    const service = new ProviderAuthService({
      runCommand: async (executable) => executable === 'pi'
        ? { stdout: '', stderr, exitCode: 1 }
        : resultFor(executable),
      onInconclusive,
    });
    const row = (await service.status({ refresh: true })).providers.find((p) => p.provider === 'pi');
    expect(row).toMatchObject({ status: 'not-installed', hint: expect.stringContaining('CEZ_PI_BIN') });
    expect(onInconclusive).not.toHaveBeenCalled();
  });

  it.each([
    ['a pi that answers --version', undefined],
    ['an explicit CEZ_PI_BIN', 'pi'],
  ])('keeps a failed pi status unknown and reported for %s', async (_label, override) => {
    if (override) process.env.CEZ_PI_BIN = override;
    const onInconclusive = vi.fn();
    const service = new ProviderAuthService({
      runCommand: async (executable, args) => {
        if (executable !== 'pi') return resultFor(executable);
        if (args.includes('--version')) return override ? { stdout: '', stderr: 'boom', exitCode: 1 } : { stdout: '1.3.0\n', stderr: '', exitCode: 0 };
        return { stdout: '', stderr: 'Error: provider config unreadable\n', exitCode: 1 };
      },
      onInconclusive,
    });
    const row = (await service.status({ refresh: true })).providers.find((p) => p.provider === 'pi');
    expect(row?.status).toBe('unknown');
    expect(onInconclusive).toHaveBeenCalledWith(expect.objectContaining({ provider: 'pi', reason: 'unrecognized_output' }));
  });

  it('recognizes the mise and pyenv shim misses, and never re-reads a successful answer', () => {
    expect(versionManagerShimMiss({ stdout: '', stderr: 'mise ERROR No version is set for shim: pi\nSet a global default version with one of the following:\nmise use -g python@3.11.9\n', exitCode: 1 }))
      .toBe('No version is set for shim: pi');
    expect(versionManagerShimMiss({ stdout: '', stderr: 'mise ERROR Tool not installed for shim: pi\n', exitCode: 1 }))
      .toBe('Tool not installed for shim: pi');
    expect(versionManagerShimMiss({ stdout: '', stderr: 'pyenv: pi: command not found\n\nThe `pi\' command exists in these Python versions:\n  3.11.9\n', exitCode: 127 }))
      .toBe('pyenv: pi: command not found');
    expect(versionManagerShimMiss({ stdout: 'No version is set for command pi', stderr: '', exitCode: 0 })).toBeNull();
    expect(versionManagerShimMiss({ stdout: '', stderr: 'Error: something else broke', exitCode: 1 })).toBeNull();
  });

  it('keeps the generic hint when Copilot spoke ACP but the answer was unreadable', async () => {
    const service = new ProviderAuthService({
      runCommand: async (executable) => executable === 'copilot'
        ? { stdout: '{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"Internal error"}}', stderr: '', exitCode: 0 }
        : { stdout: '', stderr: '', exitCode: null, errorCode: 'ENOENT' },
    });
    const row = (await service.status({ refresh: true })).providers.find((p) => p.provider === 'copilot');
    expect(row).toMatchObject({ status: 'unknown', hint: 'Authentication could not be verified. Try again.' });
  });

  // Telemetry 298c2e1f: Copilot's ACP server exits on stdin EOF without answering a request still
  // in flight, so a probe that closed stdin right after writing lost a slow `session/new`.
  it('holds stdin open until an ACP server has answered session/new', async () => {
    const server = [
      "const rl = require('node:readline').createInterface({ input: process.stdin });",
      "rl.on('line', (line) => { const { id } = JSON.parse(line);",
      "  const answer = () => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: id === 1 ? { sessionId: 's' } : {} }) + '\\n');",
      '  if (id === 1) setTimeout(answer, 300); else answer(); });',
      "rl.on('close', () => process.exit(0));",
    ].join('\n');
    const payload = '{"jsonrpc":"2.0","id":0,"method":"initialize"}\n{"jsonrpc":"2.0","id":1,"method":"session/new"}\n';
    const result = await defaultRunProviderCommand(
      process.execPath,
      ['-e', server],
      10_000,
      undefined,
      { payload, closeWhen: copilotAcpAnswered },
    );
    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(result.stdout).toContain('"sessionId":"s"');
  });

  it('closes a held-open stdin before the timeout when the answer never comes', async () => {
    const result = await defaultRunProviderCommand(
      process.execPath,
      ['-e', "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('bye'));"],
      2_500,
      undefined,
      { payload: 'not acp\n', closeWhen: copilotAcpAnswered },
    );
    expect(result).toMatchObject({ exitCode: 0, timedOut: false, stdout: 'bye' });
  });

  it('recognizes the session/new answer, result or error, and nothing earlier', () => {
    expect(copilotAcpAnswered('{"jsonrpc":"2.0","id":0,"result":{}}\n')).toBe(false);
    expect(copilotAcpAnswered('{"jsonrpc":"2.0","id":1,"result":{"sessionId":"x"}}')).toBe(true);
    expect(copilotAcpAnswered('{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"Authentication required"}}')).toBe(true);
    expect(copilotAcpAnswered('{"jsonrpc":"2.0","id":10,"result":{}}')).toBe(false);
  });

  it('reads a version with or without a leading v, never from inside a longer number', () => {
    expect(cliVersionFrom('GitHub Copilot CLI 1.0.98.')).toBe('1.0.98');
    expect(cliVersionFrom('copilot version: v1.34.1')).toBe('1.34.1');
    expect(cliVersionFrom('codex-cli 0.46.0-alpha.1')).toBe('0.46.0-alpha.1');
    expect(cliVersionFrom('build 10.1.2.3')).toBe('10.1.2');
    expect(cliVersionFrom('no version here')).toBeNull();
  });

  it('reports each provider and reason once per process, and nothing for a conclusive answer', async () => {
    const onInconclusive = vi.fn();
    let codex: ProviderCommandResult = { stdout: '???', stderr: '', exitCode: 0 };
    const service = new ProviderAuthService({ runCommand: async (executable, args) => (
      executable === 'codex' && args[0] !== '--version' ? codex : { stdout: '', stderr: '', exitCode: null, errorCode: 'ENOENT' }
    ), onInconclusive });
    await service.status({ refresh: true });
    await service.status({ refresh: true });
    expect(onInconclusive).toHaveBeenCalledTimes(1);
    codex = { stdout: 'Logged in using ChatGPT', stderr: '', exitCode: 0 };
    await service.status({ refresh: true });
    expect(onInconclusive).toHaveBeenCalledTimes(1);
  });
});
