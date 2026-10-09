import { RUNNER_IDS, type RunnerId } from '../core/agent-runner.ts';
import { claudeModelSettingsStrategy } from './model-settings/claude.ts';
import { codexModelSettingsStrategy } from './model-settings/codex.ts';
import { junieModelSettingsStrategy } from './model-settings/junie.ts';
import { kiloModelSettingsStrategy } from './model-settings/kilo.ts';
import { copilotModelSettingsStrategy } from './model-settings/copilot.ts';
import { cursorModelSettingsStrategy } from './model-settings/cursor.ts';
import { opencodeModelSettingsStrategy } from './model-settings/opencode.ts';
import { piModelSettingsStrategy } from './model-settings/pi.ts';
import type { AgentModelSettings, AgentModelSettingsStrategy } from './model-settings/types.ts';

/** The model defaults exposed by the coding agents' own settings files. */
export type AgentModelDefaults = Partial<Record<RunnerId, string>>;

/**
 * Each runner owns its native-settings policy. Adding another backend means
 * registering its strategy here; vendor precedence, environment variables,
 * and provider composition stay inside that runner's module.
 */
const MODEL_SETTINGS_STRATEGIES: Record<RunnerId, AgentModelSettingsStrategy> = {
  claude: claudeModelSettingsStrategy,
  codex: codexModelSettingsStrategy,
  opencode: opencodeModelSettingsStrategy,
  cursor: cursorModelSettingsStrategy,
  pi: piModelSettingsStrategy,
  junie: junieModelSettingsStrategy,
  copilot: copilotModelSettingsStrategy,
  // Kilo is OpenCode's fork and reads the same config SHAPE, but NOT the same files: its own home
  // is `$XDG_CONFIG_HOME/kilo` (its config file is `kilo.jsonc`), where `opencode.json` does not
  // exist. Borrowing `opencodeModelSettingsStrategy` made the Settings → Agents picker report
  // OpenCode's project model as Kilo's own (#1258) — hence a strategy that reads Kilo's catalog
  // entries instead, the same way every other runner does.
  kilo: kiloModelSettingsStrategy,
  gemini: { runner: 'gemini', read: async () => ({}) }, // Gemini has no settings file yet
  antigravity: { runner: 'antigravity', read: async () => ({}) }, // Antigravity has no settings file yet
  http: { runner: 'http', read: async () => ({}) }, // HTTP has no settings file
};

export function readAgentModelSettings(
  runner: RunnerId,
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentModelSettings> {
  return MODEL_SETTINGS_STRATEGIES[runner].read(repoRoot, env);
}

/** Read the current default model for each installed/configured coding agent. */
export async function readAgentModelDefaults(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentModelDefaults> {
  const entries = await Promise.all(
    RUNNER_IDS.map(async (runner) => [
      runner,
      (await readAgentModelSettings(runner, repoRoot, env)).model,
    ] as const),
  );
  return Object.fromEntries(entries.filter((entry): entry is readonly [RunnerId, string] => entry[1] !== undefined));
}

/** Read the provider that the agent itself will use for a bare model id. */
export async function readAgentModelProvider(
  runner: RunnerId,
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  return (await readAgentModelSettings(runner, repoRoot, env)).provider;
}
