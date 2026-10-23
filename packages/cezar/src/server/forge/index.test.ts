import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetGithubHostsCache } from '../../github-hosts.ts';
import type { RepoInfo } from '../git.ts';
import { forgeKindOfRemote, forgeWebRoot, parseRemote, resolveForge } from './index.ts';

/** Forge resolution (spec §"Forge-driver seam"): remote host → driver | null. */

const info = (remote?: string): RepoInfo => ({ root: '/repo', branch: 'main', remote });

describe('parseRemote', () => {
  it.each([
    ['https://github.com/acme/demo.git', { host: 'github.com', owner: 'acme', repo: 'demo' }],
    ['https://github.com/acme/demo', { host: 'github.com', owner: 'acme', repo: 'demo' }],
    ['https://user:token@github.com/acme/demo.git', { host: 'github.com', owner: 'acme', repo: 'demo' }],
    ['git@github.com:acme/demo.git', { host: 'github.com', owner: 'acme', repo: 'demo' }],
    ['ssh://git@github.com/acme/demo.git', { host: 'github.com', owner: 'acme', repo: 'demo' }],
    ['ssh://git@github.com:2222/acme/demo.git', { host: 'github.com', owner: 'acme', repo: 'demo' }],
    ['git://github.com/acme/demo.git', { host: 'github.com', owner: 'acme', repo: 'demo' }],
    ['https://GitHub.com/acme/demo.git', { host: 'github.com', owner: 'acme', repo: 'demo' }],
    ['https://github.com/acme/demo/', { host: 'github.com', owner: 'acme', repo: 'demo' }],
    ['git@gitlab.com:group/sub/project.git', { host: 'gitlab.com', owner: 'sub', repo: 'project' }],
  ])('parses %s', (remote, expected) => {
    expect(parseRemote(remote)).toEqual(expected);
  });

  it.each([
    ['/srv/git/demo.git'], // local bare path — not a forge
    ['../relative/path'],
    ['https://github.com/only-owner'],
    [''],
  ])('rejects %s', (remote) => {
    expect(parseRemote(remote)).toBeNull();
  });
});

describe('forgeKindOfRemote', () => {
  // The registry probe's classification (#698) — same host table as resolveForge,
  // but string-only: no driver, no repo root, no CLI.
  it.each([
    ['https://github.com/acme/demo.git', 'github'],
    ['git@github.com:acme/demo.git', 'github'],
    ['git@gitlab.com:acme/demo.git', 'gitlab'],
    ['https://gitlab.com/group/project.git', 'gitlab'],
    ['https://gitlab.example.com/acme/demo.git', 'gitlab'], // self-hosted GitLab
    ['git@codeberg.org:user/repo.git', 'forgejo'],
    ['https://codeberg.org/user/repo.git', 'forgejo'],
    ['https://gitea.example.com/acme/demo.git', 'gitea'], // self-hosted Gitea
    ['https://git.example.com/acme/demo.git', null], // unknown
    ['/srv/git/demo.git', null],
    [undefined, null],
  ])('classifies %s as %s', (remote, expected) => {
    expect(forgeKindOfRemote(remote)).toBe(expected);
  });
});

describe('resolveForge', () => {
  it('maps a github.com https remote to the GitHub driver', () => {
    expect(resolveForge(info('https://github.com/acme/demo.git'))?.kind).toBe('github');
  });

  it('maps a github.com scp-like remote to the GitHub driver', () => {
    expect(resolveForge(info('git@github.com:acme/demo.git'))?.kind).toBe('github');
  });

  it('maps a gitlab.com remote to the GitLab driver', () => {
    expect(resolveForge(info('git@gitlab.com:acme/demo.git'))?.kind).toBe('gitlab');
  });

  it('maps a self-hosted gitlab host to the GitLab driver', () => {
    expect(resolveForge(info('https://gitlab.example.com/acme/demo.git'))?.kind).toBe('gitlab');
  });

  it('maps a codeberg.org remote to the Forgejo driver', () => {
    expect(resolveForge(info('https://codeberg.org/user/repo.git'))?.kind).toBe('forgejo');
  });

  it('maps a self-hosted gitea host to the Gitea driver', () => {
    expect(resolveForge(info('https://gitea.company.com/acme/demo.git'))?.kind).toBe('gitea');
  });

  it('maps a self-hosted forgejo host to the Forgejo driver', () => {
    expect(resolveForge(info('https://forgejo.example.org/acme/demo.git'))?.kind).toBe('forgejo');
  });

  it('returns null for a generic self-hosted host', () => {
    expect(resolveForge(info('https://git.example.com/acme/demo.git'))).toBeNull();
  });

  it('returns null when the repo has no remote', () => {
    expect(resolveForge(info(undefined))).toBeNull();
  });

  it('returns null when not in a git repo at all', () => {
    expect(resolveForge(null)).toBeNull();
  });

  it('returns null for a local-path remote', () => {
    expect(resolveForge(info('/srv/git/demo.git'))).toBeNull();
  });
});

describe('GitHub driver viewUrl', () => {
  const driver = resolveForge(info('git@github.com:acme/demo.git'))!;

  it.each([
    ['repo', 'x', 'https://github.com/acme/demo'],
    ['issue', 142, 'https://github.com/acme/demo/issues/142'],
    ['pr', 128, 'https://github.com/acme/demo/pull/128'],
    ['branch', 'feat/cockpit ui', 'https://github.com/acme/demo/tree/feat/cockpit%20ui'],
    ['commit', 'abc1234', 'https://github.com/acme/demo/commit/abc1234'],
  ] as const)('%s → %s', (kind, ref, expected) => {
    expect(driver.viewUrl(kind, ref)).toBe(expected);
  });
});

describe('GitLab driver viewUrl', () => {
  const driver = resolveForge(info('git@gitlab.com:acme/demo.git'))!;

  it.each([
    ['repo', 'x', 'https://gitlab.com/acme/demo'],
    ['issue', 142, 'https://gitlab.com/acme/demo/-/issues/142'],
    ['pr', 128, 'https://gitlab.com/acme/demo/-/merge_requests/128'],
    ['branch', 'feat/ui', 'https://gitlab.com/acme/demo/-/tree/feat/ui'],
    ['commit', 'abc1234', 'https://gitlab.com/acme/demo/-/commit/abc1234'],
  ] as const)('%s → %s', (kind, ref, expected) => {
    expect(driver.viewUrl(kind, ref)).toBe(expected);
  });
});

describe('Gitea driver viewUrl', () => {
  const driver = resolveForge(info('https://gitea.example.com/acme/demo.git'))!;

  it.each([
    ['repo', 'x', 'https://gitea.example.com/acme/demo'],
    ['issue', 142, 'https://gitea.example.com/acme/demo/issues/142'],
    ['pr', 128, 'https://gitea.example.com/acme/demo/pulls/128'],
    ['branch', 'main', 'https://gitea.example.com/acme/demo/src/branch/main'],
    ['commit', 'abc1234', 'https://gitea.example.com/acme/demo/commit/abc1234'],
  ] as const)('%s → %s', (kind, ref, expected) => {
    expect(driver.viewUrl(kind, ref)).toBe(expected);
  });
});

describe('Forgejo driver viewUrl', () => {
  const driver = resolveForge(info('https://codeberg.org/user/repo.git'))!;

  it.each([
    ['repo', 'x', 'https://codeberg.org/user/repo'],
    ['issue', 142, 'https://codeberg.org/user/repo/issues/142'],
    ['pr', 128, 'https://codeberg.org/user/repo/pulls/128'],
    ['branch', 'main', 'https://codeberg.org/user/repo/src/branch/main'],
    ['commit', 'abc1234', 'https://codeberg.org/user/repo/commit/abc1234'],
  ] as const)('%s → %s', (kind, ref, expected) => {
    expect(driver.viewUrl(kind, ref)).toBe(expected);
  });
});

describe('GitHub Enterprise', () => {
  let configDir: string;
  const savedConfigDir = process.env.GH_CONFIG_DIR;
  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'cez-ghe-'));
    process.env.GH_CONFIG_DIR = configDir;
    resetGithubHostsCache();
  });
  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    process.env.GH_CONFIG_DIR = savedConfigDir;
    resetGithubHostsCache();
  });

  it.each([
    'https://company.ghe.com/acme/demo.git',
    'git@acme.ghe.com:acme/widgets.git',
  ])('recognizes %s without any gh config', (remote) => {
    expect(forgeKindOfRemote(remote)).toBe('github');
    expect(resolveForge(info(remote))?.kind).toBe('github');
  });

  it.each([
    'git@github.company.com:acme/demo.git',
    'https://github.internal/o/r',
  ])('does not guess GitHub from a github.* name without a login (%s)', (remote) => {
    expect(forgeKindOfRemote(remote)).toBeNull();
  });

  it('recognizes any host gh is signed in to, on any domain', () => {
    const remote = 'git@code.corp.example:acme/demo.git';
    expect(forgeKindOfRemote(remote)).toBeNull();
    writeFileSync(join(configDir, 'hosts.yml'), 'github.com:\n    user: me\ncode.corp.example:\n    user: me\n    oauth_token: x\n');
    resetGithubHostsCache();
    expect(forgeKindOfRemote(remote)).toBe('github');
    expect(forgeKindOfRemote('git@other.example:acme/demo.git')).toBeNull();
  });

  it('honors GH_HOST', () => {
    process.env.GH_HOST = 'code.corp.example';
    try {
      expect(forgeKindOfRemote('git@code.corp.example:acme/demo.git')).toBe('github');
    } finally {
      delete process.env.GH_HOST;
    }
  });

  it('builds web root and view URLs on the enterprise host', () => {
    const remote = 'https://user:token@company.ghe.com/acme/demo.git';
    expect(forgeWebRoot(remote)).toBe('https://company.ghe.com/acme/demo');
    const driver = resolveForge(info(remote))!;
    expect(driver.viewUrl('pr', 7)).toBe('https://company.ghe.com/acme/demo/pull/7');
    expect(driver.viewUrl('issue', 3)).toBe('https://company.ghe.com/acme/demo/issues/3');
  });
});
