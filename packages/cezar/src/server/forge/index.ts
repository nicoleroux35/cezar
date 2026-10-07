import type { RepoInfo } from '../git.ts';
import { createGithubDriver } from './github.ts';
import { createGitlabDriver } from './gitlab.ts';
import { createEnhancedGitlabDriver } from './gitlab-enhanced.ts';
import { createGiteaDriver } from './gitea.ts';
import { createEnhancedGiteaDriver, createEnhancedForgejoDriver } from './gitea-enhanced.ts';
import { createForgejoDriver } from './forgejo.ts';
import type { ForgeDriver, ForgeKind } from './types.ts';

/**
 * Forge resolution (cockpit-ui redesign spec §"Forge-driver seam"): map the
 * repo's origin remote to a driver — github.com → the GitHub driver, anything
 * else (GitLab, self-hosted, no remote, not a repo) → null. The health route
 * serializes the result as `forge: {kind, available, reason?} | null`; a null
 * forge means plain-git features only (diffs, commit, push, branches).
 */

export interface ParsedRemote {
  host: string;
  owner: string;
  repo: string;
}

/**
 * Parse a git remote URL into host/owner/repo. Handles the scheme forms
 * (`https://`, `ssh://`, `git://`, with optional credentials and port) and the
 * scp-like form (`git@host:owner/repo.git`). Null for local paths and anything
 * else that doesn't look like a forge remote.
 */
export function parseRemote(remote: string): ParsedRemote | null {
  const r = remote.trim().replace(/\/+$/, '');
  let host: string | undefined;
  let path: string | undefined;
  const url = /^(?:https?|ssh|git|git\+ssh):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/.exec(r);
  if (url) {
    [, host, path] = url;
  } else {
    // scp-like: [user@]host:owner/repo(.git) — a leading '/' (local path)
    // can't match the host group, so plain directories fall through to null.
    const scp = /^(?:[^@/:]+@)?([^:/]+):(.+)$/.exec(r);
    if (!scp) return null;
    [, host, path] = scp;
  }
  if (!host || !path) return null;
  const parts = path.replace(/\.git$/i, '').split('/').filter(Boolean);
  const owner = parts[parts.length - 2];
  const repo = parts[parts.length - 1];
  if (!owner || !repo) return null;
  return { host: host.toLowerCase(), owner, repo };
}

/** Remote host → forge kind. The one host table both `resolveForge` and the
 *  registry probe read. */
const FORGE_HOSTS: Record<string, ForgeKind> = {
  'github.com': 'github',
  'gitlab.com': 'gitlab',
  'codeberg.org': 'forgejo',
};

/**
 * Detect if a host is a GitLab instance (gitlab.com or self-hosted).
 * Self-hosted detection uses common naming patterns.
 */
function isGitLabHost(host: string): boolean {
  return host === 'gitlab.com' || host.includes('gitlab');
}

/**
 * Detect if a host is a Gitea instance.
 * Self-hosted detection uses common naming patterns.
 */
function isGiteaHost(host: string): boolean {
  return host.includes('gitea');
}

/**
 * Detect if a host is a Forgejo instance (codeberg.org or self-hosted).
 * Self-hosted detection uses common naming patterns.
 */
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
  if (!parsed) return null;
  
  // Check known hosts first
  const kind = FORGE_HOSTS[parsed.host];
  if (kind) return kind;
  
  // Check self-hosted patterns
  if (isGitLabHost(parsed.host)) return 'gitlab';
  if (isGiteaHost(parsed.host)) return 'gitea';
  if (isForgejoHost(parsed.host)) return 'forgejo';
  
  return null;
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
  if (!parsed || !(parsed.host in FORGE_HOSTS)) return null;
  return `https://${parsed.host}/${parsed.owner}/${parsed.repo}`;
}

/** Remote host → driver | null. GitLab/Gitea/Forgejo drivers added. */
export function resolveForge(repoInfo: RepoInfo | null): ForgeDriver | null {
  if (!repoInfo?.remote) return null;
  const parsed = parseRemote(repoInfo.remote);
  if (!parsed) return null;
  
  const kind = FORGE_HOSTS[parsed.host];
  if (kind === 'github') {
    return createGithubDriver(repoInfo.root, { owner: parsed.owner, repo: parsed.repo });
  }
  
  // GitLab: Use enhanced driver with full merge/diff support
  if (kind === 'gitlab' || isGitLabHost(parsed.host)) {
    return createEnhancedGitlabDriver(repoInfo.root, { host: parsed.host, owner: parsed.owner, repo: parsed.repo });
  }
  
  // Gitea: Use enhanced driver
  if (kind === 'gitea' || isGiteaHost(parsed.host)) {
    return createEnhancedGiteaDriver(repoInfo.root, { host: parsed.host, owner: parsed.owner, repo: parsed.repo });
  }
  
  // Forgejo: Use enhanced driver
  if (kind === 'forgejo' || isForgejoHost(parsed.host)) {
    return createEnhancedForgejoDriver(repoInfo.root, { host: parsed.host, owner: parsed.owner, repo: parsed.repo });
  }
  
  return null;
}

export type { ForgeDriver, ForgeAvailability, ForgeItem, ForgeKind, ForgePrStatus, ForgeRefKind } from './types.ts';
