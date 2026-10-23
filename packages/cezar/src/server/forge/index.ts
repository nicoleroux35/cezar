import { parseRemote } from '../../git-remotes.ts';
import { isGithubHost } from '../../github-hosts.ts';
import type { RepoInfo } from '../git.ts';
import { createGithubDriver } from './github.ts';
import { createEnhancedGitlabDriver } from './gitlab-enhanced.ts';
import { createEnhancedGiteaDriver, createEnhancedForgejoDriver } from './gitea-enhanced.ts';
import type { ForgeDriver, ForgeKind } from './types.ts';

/**
 * Forge resolution (cockpit-ui redesign spec §"Forge-driver seam"): map the
 * repo's origin remote to a driver — github.com or a GitHub Enterprise host → the GitHub driver,
 * GitLab/Gitea/Forgejo (the fork's multi-forge support) → their enhanced drivers, anything
 * else (no remote, not a repo) → null. The health route
 * serializes the result as `forge: {kind, available, reason?} | null`; a null
 * forge means plain-git features only (diffs, commit, push, branches).
 */

export { parseRemote, type ParsedRemote } from '../../git-remotes.ts';

/** Remote host → forge kind. The one lookup both `resolveForge` and the registry probe read;
 *  GitHub means github.com or any GitHub Enterprise host (`github-hosts.ts`), and the fork adds
 *  self-hosted GitLab/Gitea/Forgejo by name pattern. */
function forgeKindOfHost(host: string): ForgeKind | null {
  if (isGithubHost(host)) return 'github';
  if (isGitLabHost(host)) return 'gitlab';
  if (isGiteaHost(host)) return 'gitea';
  if (isForgejoHost(host)) return 'forgejo';
  return null;
}

/** Detect a GitLab instance (gitlab.com or self-hosted, by naming convention). */
function isGitLabHost(host: string): boolean {
  return host === 'gitlab.com' || host.includes('gitlab');
}

/** Detect a Gitea instance (self-hosted, by naming convention). */
function isGiteaHost(host: string): boolean {
  return host.includes('gitea');
}

/** Detect a Forgejo instance (codeberg.org or self-hosted, by naming convention). */
function isForgejoHost(host: string): boolean {
  return host === 'codeberg.org' || host.includes('forgejo');
}

/**
 * Which forge a remote URL belongs to, without building a driver (#698): the
 * registry's per-project probe classifies each root from its remote alone —
 * plain string parsing, no CLI shell-out — so the sidebar can gate each
 * project's GitHub tab on the project's own remote.
 */
export function forgeKindOfRemote(remote: string | undefined): ForgeKind | null {
  const parsed = remote ? parseRemote(remote) : null;
  return parsed ? forgeKindOfHost(parsed.host) : null;

}

/**
 * A remote's web root — `https://github.com/owner/repo` — or null for anything not on a known
 * forge host.
 *
 * Built from the PARSED remote, never by string-editing the raw one, and that is the point: a
 * remote may carry credentials (`https://user:token@github.com/o/r.git`), and this is a value the
 * cockpit renders and links to. Rebuilding it from `{host, owner, repo}` leaves nothing to leak.
 */
export function forgeWebRoot(remote: string | undefined): string | null {
  const parsed = remote ? parseRemote(remote) : null;
  if (!parsed || !forgeKindOfHost(parsed.host)) return null;
  return `https://${parsed.host}/${parsed.owner}/${parsed.repo}`;
}

/** Remote host → driver | null. GitLab/Gitea/Forgejo drivers added. */
export function resolveForge(repoInfo: RepoInfo | null): ForgeDriver | null {
  if (!repoInfo?.remote) return null;
  const parsed = parseRemote(repoInfo.remote);
  if (!parsed) return null;
  const kind = forgeKindOfHost(parsed.host);
  if (kind === 'github') {
    return createGithubDriver(repoInfo.root, { host: parsed.host, owner: parsed.owner, repo: parsed.repo });
  }
  
  // GitLab: Use enhanced driver with full merge/diff support
  if (kind === 'gitlab') {
    return createEnhancedGitlabDriver(repoInfo.root, { host: parsed.host, owner: parsed.owner, repo: parsed.repo });
  }
  
  // Gitea: Use enhanced driver
  if (kind === 'gitea') {
    return createEnhancedGiteaDriver(repoInfo.root, { host: parsed.host, owner: parsed.owner, repo: parsed.repo });
  }
  
  // Forgejo: Use enhanced driver
  if (kind === 'forgejo') {
    return createEnhancedForgejoDriver(repoInfo.root, { host: parsed.host, owner: parsed.owner, repo: parsed.repo });
  }
  
  return null;
}

export type { ForgeDriver, ForgeAvailability, ForgeItem, ForgeKind, ForgePrStatus, ForgeRefKind } from './types.ts';
