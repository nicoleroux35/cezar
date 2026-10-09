import type { AgentBackend, AgentRunner, RunnerId } from './agent-runner.ts';
import { ClaudeCliRunner } from './claude-cli-runner.ts';
import { CodexAppServerRunner } from './codex-app-server-runner.ts';
import { JunieRunner } from './junie-runner.ts';
import { CopilotAcpRunner } from './copilot-acp-runner.ts';
import { OpencodeServerRunner } from './opencode-server-runner.ts';
import { OpencodeV2ServerRunner } from './opencode-v2-server-runner.ts';
import { CursorAgentRunner } from './cursor-agent-runner.ts';
import { PiRunner } from './pi-runner.ts';
import { KiloRunner } from './kilo-runner.ts';
import { GeminiRunner } from './gemini-runner.ts';
import { AntigravityRunner } from './antigravity-runner.ts';
import { HttpAgentRunner } from './http-agent-runner.ts';
import { detectOpencodeVersion } from './opencode-version-detect.ts';

/**
 * The single place that maps a backend id onto a concrete runner. Everything
 * that used to `new ClaudeCliRunner()` (the planner and the workflow engine)
 * goes through here so switching the agent backend is one function call.
 * `claude-cli` is the legacy id for `claude`.
 */
export async function createRunner(backend: AgentBackend | RunnerId | undefined): Promise<AgentRunner> {
  switch (backend) {
    case 'codex':
      return new CodexAppServerRunner();
    case 'opencode':
      // Auto-detect OpenCode version and return appropriate runner
      return await createOpencodeRunner();
    case 'cursor':
      return new CursorAgentRunner();
    case 'pi':
      return new PiRunner();
    case 'junie':
      return new JunieRunner();
    case 'copilot':
      return new CopilotAcpRunner();
    case 'kilo':
      return new KiloRunner();
    case 'gemini':
      return new GeminiRunner();
    case 'antigravity':
      return new AntigravityRunner();
    case 'http':
      return new HttpAgentRunner();
    case 'claude':
    case 'claude-cli':
    default:
      return new ClaudeCliRunner();
  }
}

/**
 * Create the appropriate OpenCode runner based on detected version.
 * Falls back to v1 if detection fails (backward compatible).
 */
async function createOpencodeRunner(): Promise<AgentRunner> {
  try {
    const versionInfo = await detectOpencodeVersion();
    if (versionInfo.version === 'v2') {
      return new OpencodeV2ServerRunner();
    }
    // v1 or unknown -> use v1 runner
    return new OpencodeServerRunner();
  } catch {
    // Detection failed -> fallback to v1 for safety
    return new OpencodeServerRunner();
  }
}
