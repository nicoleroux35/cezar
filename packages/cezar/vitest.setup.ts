import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach } from 'vitest'

// Nothing in this suite may write to the developer's own `~/.cezar`. Most cases pin
// `CEZ_HOME` themselves, but the pin is one global for the whole worker and their
// `afterEach` deletes it — so a write that outlives its test (a timeout is enough)
// used to resolve the real home and replace the project registry with the fixture's.
//
// This file removes the unpinned state entirely: every worker gets a sandbox home,
// and the pin is restored around every test, so a case that drops it can only leave
// the NEXT write pointed at the sandbox. A test that wants the unpinned default
// deletes the variable inside its own body (see `src/paths.test.ts`) — that still
// works, because this hook runs after the test, not during it. The write guard in
// `assertCezarHomeWriteIsSandboxed` catches whatever still slips through.
// Fixture repos commit constantly; a developer's global `commit.gpgsign=true` turns each
// commit into a gpg round-trip (~0.35s) and pushes git-heavy cases past the 5s timeout
// under parallel load. Signing is irrelevant to every fixture, so switch it off here —
// injected through git's env config, so no global or repo config file is touched.
if (!process.env.GIT_CONFIG_COUNT) {
  process.env.GIT_CONFIG_COUNT = '1'
  process.env.GIT_CONFIG_KEY_0 = 'commit.gpgsign'
  process.env.GIT_CONFIG_VALUE_0 = 'false'
}

// LLM task naming is on by default (`autoNamingActive`), so any case that starts a run on
// a real backend spawned `claude -p "[cez-namer] Name this task."` on the developer's own
// subscription — the same canned tasks, every run. Off for the whole suite; a test that
// exercises the namer sets `CEZ_AUTONAME=1` itself (against mock-claude). Forced at load so
// a shell's own value cannot leak in, and re-pinned around every case like `CEZ_HOME`, so a
// case that deletes it cannot hand the next case the default-on namer.
process.env.CEZ_AUTONAME = '0'

const pinAutonameOff = (): void => {
  if (process.env.CEZ_AUTONAME === undefined) process.env.CEZ_AUTONAME = '0'
}

beforeEach(pinAutonameOff)
afterEach(pinAutonameOff)

const sandboxHome = mkdtempSync(join(realpathSync(tmpdir()), 'cez-vitest-home-'))

const pinSandboxHome = (): void => {
  if (!process.env.CEZ_HOME) process.env.CEZ_HOME = sandboxHome
}

// Provider authentication reads the agents' OWN config files for a custom endpoint
// (`src/core/provider-file-config.ts`), because that is where a provider switcher such as
// cc-switch writes one instead of exporting an environment variable. Unpinned, a probe in this
// suite would read the developer's real `~/.claude/settings.json` / `~/.codex/config.toml` and
// answer 'connected' for a fixture that deliberately configured nothing — the same unpinned-state
// trap `CEZ_HOME` above exists to remove. The sandbox dirs do not exist, so every read degrades to
// "declares nothing" and the CLI probe decides, exactly as before this feature.
const pinSandboxAgentHomes = (): void => {
  if (!process.env.CLAUDE_CONFIG_DIR) process.env.CLAUDE_CONFIG_DIR = join(sandboxHome, '.claude')
  if (!process.env.CODEX_HOME) process.env.CODEX_HOME = join(sandboxHome, '.codex')
}

// Gemini and Antigravity have no relocation variable AT ALL: neither CLI reads a
// `GEMINI_DIR`-style override (the symbol of that name in the shipped gemini-cli 0.61.0 is the
// directory NAME, joined onto `homedir()`), so their credential lives in `$HOME/.gemini` and the
// only way to keep a probe off the developer's real one is to move HOME itself
// (`provider-file-config.ts`'s `geminiHome`). Unpinned, a probe here reads the developer's real
// `~/.gemini/oauth_creds.json` and answers 'connected' for a fixture that configured nothing —
// the same trap `CEZ_HOME` and the agent homes above exist to remove, with no variable of its own
// to pin. Redirecting HOME is safe for the rest of the suite: every git invocation that needs an
// identity passes it explicitly (`-c user.name=…`), and every path cezar derives from a home goes
// through `CEZ_HOME` or the agent homes pinned above.
const sandboxUserHome = join(sandboxHome, 'user-home')

const pinSandboxUserHome = (): void => {
  process.env.HOME = sandboxUserHome
  if (process.platform === 'win32') process.env.USERPROFILE = sandboxUserHome
}

// The provider variables a descriptor's `precheck` reads. Every one of them answers BEFORE the
// CLI probe is spawned, so a developer who simply has `ANTHROPIC_API_KEY` exported makes claude
// 'connected' in every fixture that deliberately configured nothing — the same unpinned-state
// trap as `CEZ_HOME` and the agent homes above, and the one that actually bit: it silently
// changed probe-call counts and turned a "log out, then Connect" case into "already connected",
// on the developer's machine only. Pinning the FILES these agents read (above) is not enough,
// because the environment is the other half of the same question.
//
// DELETED, not defaulted, unlike the pins above: there is no sandbox value for "an API key", and
// a test that wants one sets it in its own body (as `provider-auth.test.ts` does) — this hook
// runs before the file's own, and restores nothing, so it can only ever remove what leaked in.
const PROVIDER_CREDENTIAL_ENV = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT',
  'CURSOR_API_KEY', 'CURSOR_BASE_URL',
  'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_BASE_URL',
  'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'MISTRAL_API_KEY', 'DEEPSEEK_API_KEY', 'XAI_API_KEY',
  'PERPLEXITY_API_KEY', 'TOGETHER_API_KEY', 'FIREWORKS_API_KEY',
  'OPENROUTER_BASE_URL', 'GROQ_BASE_URL', 'MISTRAL_BASE_URL',
  'CEZ_HTTP_AGENT_CONFIG',
] as const

const clearProviderCredentialEnv = (): void => {
  for (const name of PROVIDER_CREDENTIAL_ENV) delete process.env[name]
}

pinSandboxHome()
pinSandboxAgentHomes()
pinSandboxUserHome()
clearProviderCredentialEnv()
beforeEach(pinSandboxHome)
beforeEach(pinSandboxAgentHomes)
beforeEach(pinSandboxUserHome)
beforeEach(clearProviderCredentialEnv)
// Registered before any suite's own hooks, so vitest runs it last on the way out —
// after a case's `afterEach` has deleted the pin.
afterEach(pinSandboxHome)
afterEach(pinSandboxAgentHomes)
afterEach(pinSandboxUserHome)
afterEach(clearProviderCredentialEnv)
afterAll(() => {
  rmSync(sandboxHome, { recursive: true, force: true })
})
