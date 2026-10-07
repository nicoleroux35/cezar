import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type {
  DraftPrInput,
  DraftPrOutcome,
  ForgeAvailability,
  ForgeDriver,
  ForgeItem,
  ForgeListOptions,
  ForgeMergeInput,
  ForgeMergeResult,
  ForgePrMergeStateResult,
  ForgePrStatus,
  ForgePrDiffResult,
  ForgeRefKind,
  ForgeSearchData,
} from './types.ts';

/**
 * Forgejo forge driver — uses `tea` CLI (https://gitea.com/gitea/tea) since
 * Forgejo is a Gitea fork and maintains CLI compatibility. Supports codeberg.org
 * and self-hosted Forgejo instances.
 */

const exec = promisify(execFile);

export interface ForgejoRepoRef {
  host: string;
  owner: string;
  repo: string;
}

const CACHE_MS = 60_000;
const TEA_MAX_LIMIT = 1000;

async function tea(repoRoot: string, args: string[], timeout = 15_000): Promise<string> {
  const { stdout } = await exec('tea', args, {
    cwd: repoRoot,
    timeout,
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout;
}

function firstLine(s: string): string {
  return s.split('\n').find((l) => l.trim().length > 0)?.trim() ?? 'tea failed';
}

const listCache = new Map<string, { at: number; limit: number; data: { issues: ForgeItem[]; prs: ForgeItem[] } }>();
const LIST_CACHE_MAX = 50;

let availabilityCache: { at: number; result: ForgeAvailability } | null = null;

async function detectTea(repoRoot: string): Promise<ForgeAvailability> {
  try {
    await tea(repoRoot, ['--version'], 5_000);
    return { available: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reason = /ENOENT/.test(message)
      ? 'tea CLI not found — install it from https://gitea.com/gitea/tea (Forgejo compatible)'
      : firstLine(message);
    return { available: false, reason };
  }
}

export function createForgejoDriver(repoRoot: string, repoRef: ForgejoRepoRef | null): ForgeDriver {
  const repoPath = repoRef ? `${repoRef.owner}/${repoRef.repo}` : null;

  return {
    kind: 'forgejo',

    async detect(): Promise<ForgeAvailability> {
      const hit = availabilityCache;
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;
      const result = await detectTea(repoRoot);
      availabilityCache = { at: Date.now(), result };
      return result;
    },

    detectCached(): ForgeAvailability | null {
      return availabilityCache?.result ?? null;
    },

    async listIssues(opts?: ForgeListOptions): Promise<ForgeItem[]> {
      if (process.env.CEZ_DRY_RUN === '1') return mockForgejoIssues();
      
      const capped = Math.min(opts?.limit ?? 30, TEA_MAX_LIMIT);
      const cacheKey = `${repoRoot}\0issues\0${capped}`;
      const hit = listCache.get(cacheKey);
      
      if (!opts?.refresh && hit && Date.now() - hit.at < CACHE_MS && hit.limit >= capped) {
        return hit.data.issues;
      }

      try {
        const args = ['issues', 'list', '--limit', String(capped), '--state', 'open'];
        if (repoPath) args.push('--repo', repoPath);
        
        const out = await tea(repoRoot, args);
        const issues = parseForgejoIssues(out, repoRef);
        
        listCache.set(cacheKey, {
          at: Date.now(),
          limit: capped,
          data: { issues, prs: hit?.data.prs ?? [] },
        });
        
        return issues;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`Forgejo issue list failed: ${firstLine(message)}`);
        return [];
      }
    },

    async listPRs(opts?: ForgeListOptions): Promise<ForgeItem[]> {
      if (process.env.CEZ_DRY_RUN === '1') return mockForgejoPRs();
      
      const capped = Math.min(opts?.limit ?? 30, TEA_MAX_LIMIT);
      const cacheKey = `${repoRoot}\0prs\0${capped}`;
      const hit = listCache.get(cacheKey);
      
      if (!opts?.refresh && hit && Date.now() - hit.at < CACHE_MS && hit.limit >= capped) {
        return hit.data.prs;
      }

      try {
        const args = ['pulls', 'list', '--limit', String(capped), '--state', 'open'];
        if (repoPath) args.push('--repo', repoPath);
        
        const out = await tea(repoRoot, args);
        const prs = parseForgejoPRs(out, repoRef);
        
        listCache.set(cacheKey, {
          at: Date.now(),
          limit: capped,
          data: { issues: hit?.data.issues ?? [], prs },
        });
        
        return prs;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`Forgejo PR list failed: ${firstLine(message)}`);
        return [];
      }
    },

    async searchItems(kind: 'issue' | 'pr', query: string, opts?: { limit?: number }): Promise<ForgeSearchData> {
      if (process.env.CEZ_DRY_RUN === '1') {
        return { available: true, items: kind === 'issue' ? mockForgejoIssues() : mockForgejoPRs(), truncated: false };
      }

      try {
        const capped = Math.min(opts?.limit ?? 50, 100);
        const args = kind === 'issue'
          ? ['issues', 'list', '--limit', String(capped), '--search', query]
          : ['pulls', 'list', '--limit', String(capped), '--search', query];
        
        if (repoPath) args.push('--repo', repoPath);
        
        const out = await tea(repoRoot, args, 30_000);
        const items = kind === 'issue' ? parseForgejoIssues(out, repoRef) : parseForgejoPRs(out, repoRef);
        
        return {
          available: true,
          items,
          truncated: items.length >= capped,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          available: false,
          reason: firstLine(message),
          items: [],
        };
      }
    },

    async createPR(input: DraftPrInput): Promise<DraftPrOutcome> {
      if (process.env.CEZ_DRY_RUN === '1') {
        return { ok: true, url: `https://${repoRef?.host}/${repoRef?.owner}/${repoRef?.repo}/pulls/1`, dryRun: true };
      }

      try {
        const args = [
          'pulls', 'create',
          '--title', `[Draft] ${input.run.title || 'Task completion'}`,
          '--description', input.handoffText,
        ];

        const out = await tea(input.repoRoot, args, 30_000);
        const urlMatch = out.match(/https?:\/\/[^\s]+/);
        
        if (urlMatch) {
          return { ok: true, url: urlMatch[0], dryRun: false };
        }
        
        return { ok: false, error: 'Could not extract PR URL from tea output' };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: firstLine(message) };
      }
    },

    async prStatus(branch: string): Promise<ForgePrStatus | null> {
      if (process.env.CEZ_DRY_RUN === '1') return null;

      try {
        const args = ['pulls', 'list', '--state', 'open'];
        if (repoPath) args.push('--repo', repoPath);
        
        const out = await tea(repoRoot, args, 10_000);
        const prs = parseForgejoPRs(out, repoRef);
        
        const pr = prs.find(p => p.title.includes(branch));
        if (!pr) return null;
        
        return {
          number: pr.number,
          url: pr.url,
          state: 'open',
          isDraft: pr.isDraft ?? false,
          checks: null,
        };
      } catch {
        return null;
      }
    },

    async prMergeState(number: number, opts?: { refresh?: boolean }): Promise<ForgePrMergeStateResult> {
      return {
        available: false,
        reason: 'Forgejo merge state details not yet implemented',
      };
    },

    async mergePR(number: number, input: ForgeMergeInput): Promise<ForgeMergeResult> {
      return {
        merged: false,
        status: 502,
        error: 'Forgejo PR merging not yet implemented',
      };
    },

    async prDiff(number: number, opts?: { refresh?: boolean }): Promise<ForgePrDiffResult> {
      return {
        available: false,
        reason: 'Forgejo PR diff not yet implemented',
      };
    },

    viewUrl(kind: ForgeRefKind, ref: string | number): string | null {
      if (!repoRef) return null;
      
      const base = `https://${repoRef.host}/${repoRef.owner}/${repoRef.repo}`;
      
      switch (kind) {
        case 'repo':
          return base;
        case 'issue':
          return `${base}/issues/${ref}`;
        case 'pr':
          return `${base}/pulls/${ref}`;
        case 'branch':
          return `${base}/src/branch/${ref}`;
        case 'commit':
          return `${base}/commit/${ref}`;
        default:
          return null;
      }
    },
  };
}

function parseForgejoIssues(output: string, repoRef: ForgejoRepoRef | null): ForgeItem[] {
  const lines = output.trim().split('\n').filter(l => l.trim());
  const items: ForgeItem[] = [];
  
  for (const line of lines) {
    if (line.startsWith('#') || line.includes('---') || !line.includes('#')) continue;
    
    const match = line.match(/#(\d+)\s+(.+)/);
    if (match) {
      const [, numberStr, rest] = match;
      if (!numberStr || !rest) continue;
      const number = parseInt(numberStr, 10);

      const url = repoRef
        ? `https://${repoRef.host}/${repoRef.owner}/${repoRef.repo}/issues/${number}`
        : '';

      items.push({
        kind: 'issue',
        number,
        title: (rest.trim().split(/\s+\|\s+/)[0] ?? '').trim(),
        author: 'unknown',
        createdAt: new Date().toISOString(),
        labels: [],
        body: '',
        url,
        comments: 0,
      });
    }
  }
  
  return items;
}

function parseForgejoPRs(output: string, repoRef: ForgejoRepoRef | null): ForgeItem[] {
  const lines = output.trim().split('\n').filter(l => l.trim());
  const items: ForgeItem[] = [];
  
  for (const line of lines) {
    if (line.startsWith('#') || line.includes('---') || !line.includes('#')) continue;

    const match = line.match(/#(\d+)\s+(.+)/);
    if (match) {
      const [, numberStr, rest] = match;
      if (!numberStr || !rest) continue;
      const number = parseInt(numberStr, 10);

      const url = repoRef
        ? `https://${repoRef.host}/${repoRef.owner}/${repoRef.repo}/pulls/${number}`
        : '';

      items.push({
        kind: 'pr',
        number,
        title: (rest.trim().split(/\s+\|\s+/)[0] ?? '').trim(),
        author: 'unknown',
        createdAt: new Date().toISOString(),
        labels: [],
        body: '',
        url,
        comments: 0,
        isDraft: rest.toLowerCase().includes('draft') || rest.includes('[Draft]'),
        additions: 0,
        deletions: 0,
        checks: null,
      });
    }
  }
  
  return items;
}

function mockForgejoIssues(): ForgeItem[] {
  return [
    {
      kind: 'issue',
      number: 1,
      title: 'Sample Forgejo issue',
      author: 'forgejo-user',
      createdAt: new Date().toISOString(),
      labels: ['bug'],
      body: 'This is a mock issue for dry-run mode',
      url: 'https://codeberg.org/example/repo/issues/1',
      comments: 1,
    },
  ];
}

function mockForgejoPRs(): ForgeItem[] {
  return [
    {
      kind: 'pr',
      number: 1,
      title: '[Draft] Sample Forgejo PR',
      author: 'forgejo-user',
      createdAt: new Date().toISOString(),
      labels: ['enhancement'],
      body: 'This is a mock PR for dry-run mode',
      url: 'https://codeberg.org/example/repo/pulls/1',
      comments: 0,
      isDraft: true,
      additions: 12,
      deletions: 2,
      checks: null,
    },
  ];
}
