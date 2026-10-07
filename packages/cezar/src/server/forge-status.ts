import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ForgeKind, ForgeStatus, ForgesStatusResponse } from '@open-mercato/maestro-contract';

/**
 * Forge CLI detection and authentication status service.
 *
 * Probes each forge's CLI (gh, glab, tea) for installation and authentication.
 * Used by the Settings → Forges UI to show connection status.
 */

const exec = promisify(execFile);

interface ForgeCliInfo {
  cli: string;
  versionFlag: string[];
  authCheckFlag: string[];
}

const FORGE_CLI_MAP: Record<ForgeKind, ForgeCliInfo> = {
  github: { cli: 'gh', versionFlag: ['--version'], authCheckFlag: ['auth', 'status'] },
  gitlab: { cli: 'glab', versionFlag: ['version'], authCheckFlag: ['auth', 'status'] },
  gitea: { cli: 'tea', versionFlag: ['--version'], authCheckFlag: ['login', 'list'] },
  forgejo: { cli: 'tea', versionFlag: ['--version'], authCheckFlag: ['login', 'list'] },
};

async function checkForgeCli(kind: ForgeKind): Promise<ForgeStatus> {
  const info = FORGE_CLI_MAP[kind];

  try {
    // Check if CLI is installed
    const { stdout: versionOutput } = await exec(info.cli, info.versionFlag, { timeout: 5000 });
    const version = versionOutput.trim().split('\n')[0];

    // Check authentication
    try {
      const { stdout: authOutput } = await exec(info.cli, info.authCheckFlag, { timeout: 5000 });

      // Parse authentication status
      const authenticated = !authOutput.includes('not logged in') &&
                          !authOutput.includes('You are not logged in') &&
                          !authOutput.includes('not configured');

      // Extract username
      const userMatch = authOutput.match(/Logged in to .+ as ([^\s]+)/i) ||
                       authOutput.match(/account ([^\s]+)/i) ||
                       authOutput.match(/username: ([^\s]+)/i);
      const user = userMatch?.[1];

      // Extract host
      const hostMatch = authOutput.match(/Logged in to ([^\s]+)/i) ||
                       authOutput.match(/host: ([^\s]+)/i) ||
                       authOutput.match(/url: ([^\s]+)/i);
      const host = hostMatch?.[1];

      return {
        kind,
        available: true,
        authenticated,
        cli: info.cli,
        version,
        ...(user && { user }),
        ...(host && { host }),
        ...(!authenticated && { hint: `Run: ${info.cli} auth login` }),
      };
    } catch (authErr) {
      // CLI exists but auth check failed (likely not authenticated)
      const authMessage = authErr instanceof Error ? authErr.message : String(authErr);
      const notAuthenticated = authMessage.includes('not logged in') ||
                              authMessage.includes('You are not logged in');

      return {
        kind,
        available: true,
        authenticated: false,
        cli: info.cli,
        version,
        hint: notAuthenticated
          ? `Run: ${info.cli} auth login`
          : `Error checking auth: ${authMessage.split('\n')[0]}`,
      };
    }
  } catch (err) {
    // CLI not installed
    const message = err instanceof Error ? err.message : String(err);
    const isNotFound = /ENOENT/.test(message);

    const installHints: Record<ForgeKind, string> = {
      github: 'gh CLI not found — install from https://cli.github.com',
      gitlab: 'glab CLI not found — install from https://gitlab.com/gitlab-org/cli',
      gitea: 'tea CLI not found — install from https://gitea.com/gitea/tea',
      forgejo: 'tea CLI not found — install from https://gitea.com/gitea/tea',
    };

    return {
      kind,
      available: false,
      authenticated: false,
      cli: info.cli,
      hint: isNotFound
        ? installHints[kind]
        : `Error checking ${info.cli}: ${message.split('\n')[0]}`,
    };
  }
}

/**
 * Check authentication status for all four forges.
 *
 * Runs CLI checks in parallel. Never throws — unavailable CLIs are reported
 * as `available: false` with a hint.
 */
export async function getForgesStatus(opts?: { refresh?: boolean }): Promise<ForgesStatusResponse> {
  // Run all checks in parallel
  const statuses = await Promise.all(
    (['github', 'gitlab', 'gitea', 'forgejo'] as ForgeKind[]).map(checkForgeCli),
  );

  return { forges: statuses };
}

/**
 * Build the authentication command for a forge.
 *
 * For self-hosted instances, includes the host parameter.
 */
export function buildForgeAuthCommand(kind: ForgeKind, host?: string): string {
  const commands: Record<ForgeKind, (host?: string) => string> = {
    github: () => 'gh auth login',
    gitlab: (h) => h ? `glab auth login --hostname ${h}` : 'glab auth login',
    gitea: (h) => h ? `tea login add --url ${h}` : 'tea login add',
    forgejo: (h) => h ? `tea login add --url ${h}` : 'tea login add',
  };

  return commands[kind](host);
}
