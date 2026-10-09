import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { agentHomePaths, expandTilde } from '../paths.ts';

/**
 * Endpoints and credentials an agent declares in its OWN config file, rather than in the
 * environment.
 *
 * `provider-auth.ts`'s `precheck` reads `process.env`, which is how cezar has always accepted a
 * custom endpoint and is enough for the documented `export ANTHROPIC_BASE_URL=…` flow. It is NOT
 * how a provider switcher works: cc-switch (and tools like it) never exports anything — it writes
 * the endpoint into the agent's own config file, `~/.claude/settings.json`'s `env` block or
 * `~/.codex/config.toml`'s `[model_providers.<id>]`, and the CLI then uses it with no variable set
 * at all. For such a Codex provider `codex login status` even answers "Not logged in" — a custom
 * provider (`requires_openai_auth = false`) has no login to report — so the CLI probe confidently
 * calls a working setup disconnected. Reading the file is the only thing that knows.
 *
 * Everything here is best-effort and never throws: a missing file, an unreadable directory, bad
 * TOML/JSON or an unexpected shape all answer "declares nothing", which leaves the CLI probe to
 * decide exactly as it did before. The reads are synchronous and tiny, and they happen only on a
 * probe cache miss (minutes for a connected answer), so the cost is not on any hot path.
 */

/** The config dir a probe should read: the agent profile's own dir when it has one (spec
 *  2026-07-29-agent-profiles), the host-discovered home otherwise. Mirrors how `probe()` resolves
 *  the environment for a per-account row — reading the DEFAULT home for a named account would
 *  report an endpoint that account will never use. */
export function providerConfigDir(provider: 'claude' | 'codex', configDir?: string | null): string {
  const override = configDir?.trim();
  if (override) return expandTilde(override);
  const homes = agentHomePaths();
  return provider === 'claude' ? homes.claude : homes.codex;
}

/** Does `~/.claude/settings.json` (or a profile's own) configure an endpoint or credential in its
 *  `env` block? Any of the three is enough — an API key, an auth token or a base URL all mean the
 *  CLI can talk to a provider without an interactive login. */
export function claudeFileDeclaresAuth(claudeHome: string): boolean {
  const settings = readJsonObject(join(claudeHome, 'settings.json'));
  const env = objectValue(settings?.env);
  if (!env) return false;
  return ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'].some((key) =>
    nonEmptyString(env[key]));
}

/**
 * Does `~/.codex/config.toml` (or a profile's own) select a custom provider that carries its own
 * endpoint and credential?
 *
 * A `base_url` alone is not proof: the built-in `openai` provider keeps its ChatGPT login even
 * when pointed elsewhere. The entry is only self-sufficient when it says so
 * (`requires_openai_auth = false`, which is also what an unauthenticated local endpoint such as
 * Ollama uses) or carries a credential itself — an inline bearer token, or an `env_key` naming a
 * variable that is actually set.
 */
export function codexFileDeclaresAuth(codexHome: string): boolean {
  const config = readTomlObject(join(codexHome, 'config.toml'));
  if (!config) return false;
  const active = nonEmptyString(config.model_provider) ? config.model_provider.trim() : '';
  if (!active) return false;
  const entry = objectValue(objectValue(config.model_providers)?.[active]);
  if (!entry || !nonEmptyString(entry.base_url)) return false;
  if (entry.requires_openai_auth === false) return true;
  if (nonEmptyString(entry.experimental_bearer_token)) return true;
  const envKey = nonEmptyString(entry.env_key) ? entry.env_key.trim() : '';
  return envKey !== '' && nonEmptyString(process.env[envKey]);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Gemini's home. There is NO relocation variable to honour: the `GEMINI_DIR` symbol in the shipped
 * CLI (0.61.0) is the directory NAME — `.gemini`, joined onto `homedir()` — not an environment
 * override, and `GEMINI_PROJECT_DIR` is the workspace, not the config home. Verified 2026-10-09.
 *
 * A named accessor rather than a second copy of the rule: `agentHomePaths().gemini` owns it, the
 * same way that table owns every other agent home. Antigravity's state lives in a subdirectory of
 * this same home (`antigravity-cli/`), so both probes read one path.
 */
export function geminiHome(env: NodeJS.ProcessEnv = process.env): string {
  return agentHomePaths(env).gemini;
}

/**
 * Gemini's own answer to "am I authenticated?" is `gemini --version`, which prints a version and
 * nothing else — there is no `auth status` subcommand in 0.61.0's `--help`. So cezar's probe could
 * only ever answer 'unknown' for it, and `unavailableProviderMessage` blocks a run whose provider
 * is not 'connected' — Gemini was unrunnable without an API key in the environment. The stored
 * credential is what knows: an OAuth login writes `oauth_creds.json` (access + refresh token) and
 * `google_accounts.json` (`active` = the signed-in address).
 *
 * A refresh token is renewable and an access token is what a headless run uses, so either is a
 * login; a stale one is caught the way any other dead credential is — the runtime-auth latch
 * (`server/provider-auth-runtime.ts`) sees the 401 and marks the provider disconnected.
 */
export function geminiFileDeclaresAuth(geminiDir: string): boolean {
  const creds = readJsonObject(join(geminiDir, 'oauth_creds.json'));
  if (creds && (nonEmptyString(creds.refresh_token) || nonEmptyString(creds.access_token))) return true;
  const accounts = readJsonObject(join(geminiDir, 'google_accounts.json'));
  return accounts !== undefined && nonEmptyString(accounts.active);
}

/**
 * Antigravity (`agy`) has the same blind spot — `agy --help` (1.3.0) lists no auth-status
 * subcommand either, and `agy --version` prints `1.3.0` — and keeps its own login in
 * `~/.gemini/antigravity-cli/antigravity-oauth-token` (a JSON object with `auth_method`, `token`
 * and `id_token`; observed on disk 2026-10-09). Any of the two credential fields means signed in.
 */
export function antigravityFileDeclaresAuth(geminiDir: string): boolean {
  const token = readJsonObject(join(geminiDir, 'antigravity-cli', 'antigravity-oauth-token'));
  return token !== undefined && (nonEmptyString(token.token) || nonEmptyString(token.id_token));
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  const text = readText(path);
  if (text === undefined) return undefined;
  try {
    return objectValue(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function readTomlObject(path: string): Record<string, unknown> | undefined {
  const text = readText(path);
  if (text === undefined) return undefined;
  try {
    return objectValue(parseToml(text) as unknown);
  } catch {
    return undefined;
  }
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}
