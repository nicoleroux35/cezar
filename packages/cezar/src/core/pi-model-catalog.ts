import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ModelOption } from './runner-model-catalog.ts';
import { spawnableCommand } from './windows-shim.ts';

const exec = promisify(execFile);

export interface PiModelDiscoveryOptions {
  bin?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Injected for tests — defaults to `execFile(bin, ['--list-models'], …)`. */
  run?: (bin: string, env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<{ stdout: string; stderr: string }>;
}

const DEFAULT_DISCOVERY_TIMEOUT_MS = 15_000;
const MAX_MODELS = 500;

/**
 * Parse `pi --list-models` output. A fixed-width table whose header row is
 * `provider  model  context  max-out  thinking  images`; the id the runner
 * hands back to pi is `provider/model` (pi re-splits it, and the model half
 * may itself carry slashes — `z-ai/glm-5.3`). Context/thinking/images are the
 * picker's free description.
 */
export function parsePiModelsOutput(text: string): ModelOption[] {
  const models: ModelOption[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^provider\s+model\s/i.test(line)) continue; // header
    // Two leading columns only — the rest (context, thinking, images) is noise.
    const match = /^(\S+)\s+(\S+(?:\s\S+)*?)(?:\s{2,}|$)/.exec(line);
    if (!match) continue;
    const provider = match[1]!;
    const model = match[2]!.trim();
    if (!provider || !model || provider === 'provider') continue;
    // Table rows always carry the size columns after the model; a diagnostic line
    // ("pi: no models configured", "No models matching \"x\"") does not.
    if (!/\s{2,}(context|max-out)\s/.test(rawLine) && !/\s{2,}\S+\s+\S+\s*$/.test(rawLine)) continue;
    const id = `${provider}/${model}`;
    if (seen.has(id)) continue;
    if (models.length >= MAX_MODELS) break;
    seen.add(id);
    models.push({ id, label: model, description: provider });
  }
  return models;
}

/** Discover models from the host's pi CLI (`pi --list-models`). */
export async function discoverPiModels(
  options: PiModelDiscoveryOptions = {},
): Promise<ModelOption[]> {
  const bin = options.bin ?? process.env.CEZ_PI_BIN ?? 'pi';
  const timeoutMs = options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
  const env = options.env ?? process.env;
  const run =
    options.run ??
    (async (executable, runEnv, timeout) =>
      exec(...spawnableCommand(executable, ['--list-models']), {
        timeout,
        env: runEnv,
        maxBuffer: 2 * 1024 * 1024,
      }));

  const { stdout, stderr } = await run(bin, env, timeoutMs);
  const models = parsePiModelsOutput(`${stdout}\n${stderr}`);
  if (models.length === 0) {
    throw new Error('pi model discovery returned no models');
  }
  return models;
}
