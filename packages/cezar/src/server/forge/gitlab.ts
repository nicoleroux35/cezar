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
 * GitLab forge driver — uses `glab` CLI (https://gitlab.com/gitlab-org/cli)
 * for GitLab.com and self-hosted GitLab instances. Implements the same
 * ForgeDriver seam as GitHub.
 */

const exec = promisify(execFile);

export interface GitlabRepoRef {
  host: string;
  owner: string;
  repo: string;
}

const CACHE_MS = 60_000;
const GLAB_MAX_LIMIT = 1000;

// GitLab API schemas (glab --json output)
const glabAuthor = z.object({ username: z.string() }).nullish();
const glabLabel = z.object({ name: z.string(), color: z.string().default('') });

const glabIssueSchema = z.object({
  iid: z.number(), // GitLab uses iid (internal ID) not id
  title: z.string(),
  author: glabAuthor,
  created_at: z.string(),
  labels: z.array(z.string()).default([]),
  description: z.string().nullish(),
  web_url: z.string(),
  user_notes_count: z.number().default(0),
});

const glabMrSchema = glabIssueSchema.extend({
  draft: z.boolean().default(false),
  // GitLab doesn't provide additions/deletions in list view easily
  // We'll populate these as null/0 and fetch on demand if needed
});

async function glab(repoRoot: string, args: string[], timeout = 15_000): Promise<string> {
  const { stdout } = await exec('glab', args, {
    cwd: repoRoot,
    timeout,
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout;
}

function firstLine(s: string): string {
  return s.split('\n').find((l) => l.trim().length > 0)?.trim() ?? 'glab failed';
}

const listCache = new Map<string, { at: number; limit: number; data: { issues: ForgeItem[]; prs: ForgeItem[] } }>();
const LIST_CACHE_MAX = 50;

let availabilityCache: { at: number; result: ForgeAvailability } | null = null;

async function detectGlab(repoRoot: string): Promise<ForgeAvailability> {
  try {
    await glab(repoRoot, ['version'], 5_000);
    return { available: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reason = /ENOENT/.test(message)
      ? 'glab CLI not found — install it from https://gitlab.com/gitlab-org/cli'
      : firstLine(message);
    return { available: false, reason };
  }
}

export function createGitlabDriver(repoRoot: string, repoRef: GitlabRepoRef | null): ForgeDriver {
  const projectPath = repoRef ? `${repoRef.owner}/${repoRef.repo}` : null;

  return {
    kind: 'gitlab',

    async detect(): Promise<ForgeAvailability> {
      const hit = availabilityCache;
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;
      const result = await detectGlab(repoRoot);
      availabilityCache = { at: Date.now(), result };
      return result;
    },

    detectCached(): ForgeAvailability | null {
      return availabilityCache?.result ?? null;
    },

    async listIssues(opts?: ForgeListOptions): Promise<ForgeItem[]> {
      if (process.env.CEZ_DRY_RUN === '1') return mockGitlabIssues();
      
      const capped = Math.min(opts?.limit ?? 30, GLAB_MAX_LIMIT);
      const cacheKey = `${repoRoot}\0issues\0${capped}`;
      const hit = listCache.get(cacheKey);
      
      if (!opts?.refresh && hit && Date.now() - hit.at < CACHE_MS && hit.limit >= capped) {
        return hit.data.issues;
      }

      try {
        const args = ['issue', 'list', '--per-page', String(capped)];
        if (projectPath) args.push('--repo', projectPath);
        
        const out = await glab(repoRoot, args);
        const issues = parseGitlabIssues(out);
        
        listCache.set(cacheKey, {
          at: Date.now(),
          limit: capped,
          data: { issues, prs: hit?.data.prs ?? [] },
        });
        
        return issues;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`GitLab issue list failed: ${firstLine(message)}`);
        return [];
      }
    },

    async listPRs(opts?: ForgeListOptions): Promise<ForgeItem[]> {
      if (process.env.CEZ_DRY_RUN === '1') return mockGitlabMRs();
      
      const capped = Math.min(opts?.limit ?? 30, GLAB_MAX_LIMIT);
      const cacheKey = `${repoRoot}\0mrs\0${capped}`;
      const hit = listCache.get(cacheKey);
      
      if (!opts?.refresh && hit && Date.now() - hit.at < CACHE_MS && hit.limit >= capped) {
        return hit.data.prs;
      }

      try {
        const args = ['mr', 'list', '--per-page', String(capped)];
        if (projectPath) args.push('--repo', projectPath);
        
        const out = await glab(repoRoot, args);
        const prs = parseGitlabMRs(out);
        
        listCache.set(cacheKey, {
          at: Date.now(),
          limit: capped,
          data: { issues: hit?.data.issues ?? [], prs },
        });
        
        return prs;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`GitLab MR list failed: ${firstLine(message)}`);
        return [];
      }
    },

    async searchItems(kind: 'issue' | 'pr', query: string, opts?: { limit?: number }): Promise<ForgeSearchData> {
      if (process.env.CEZ_DRY_RUN === '1') {
        return { available: true, items: kind === 'issue' ? mockGitlabIssues() : mockGitlabMRs(), truncated: false };
      }

      try {
        const capped = Math.min(opts?.limit ?? 50, 100);
        const args = kind === 'issue' 
          ? ['issue', 'list', '--search', query, '--per-page', String(capped)]
          : ['mr', 'list', '--search', query, '--per-page', String(capped)];
        
        if (projectPath) args.push('--repo', projectPath);
        
        const out = await glab(repoRoot, args, 30_000);
        const items = kind === 'issue' ? parseGitlabIssues(out) : parseGitlabMRs(out);
        
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
        return { ok: true, url: `https://${repoRef?.host}/${repoRef?.owner}/${repoRef?.repo}/-/merge_requests/1`, dryRun: true };
      }

      try {
        // Create draft MR with glab
        const args = [
          'mr', 'create',
          '--title', input.run.title || 'Draft: Task completion',
          '--description', input.handoffText,
          '--draft',
          '--yes', // Skip confirmation
        ];

        const out = await glab(input.repoRoot, args, 30_000);
        const urlMatch = out.match(/https?:\/\/[^\s]+/);
        
        if (urlMatch) {
          return { ok: true, url: urlMatch[0], dryRun: false };
        }
        
        return { ok: false, error: 'Could not extract MR URL from glab output' };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: firstLine(message) };
      }
    },

    async prStatus(branch: string): Promise<ForgePrStatus | null> {
      if (process.env.CEZ_DRY_RUN === '1') return null;

      try {
        const args = ['mr', 'list', '--source-branch', branch, '--per-page', '1'];
        if (projectPath) args.push('--repo', projectPath);
        
        const out = await glab(repoRoot, args, 10_000);
        const mrs = parseGitlabMRs(out);
        
        if (mrs.length === 0) return null;

        const mr = mrs[0];
        if (!mr) {
          return null;
        }
        return {
          number: mr.number,
          url: mr.url,
          state: 'open', // Simplified - would need more API calls for exact state
          isDraft: mr.isDraft ?? false,
          checks: null,
        };
      } catch {
        return null;
      }
    },

    async prMergeState(number: number, opts?: { refresh?: boolean }): Promise<ForgePrMergeStateResult> {
      // GitLab merge state would require detailed API calls
      // For now, return unavailable - can be implemented later
      return {
        available: false,
        reason: 'GitLab merge state details not yet implemented',
      };
    },

    async mergePR(number: number, input: ForgeMergeInput): Promise<ForgeMergeResult> {
      // GitLab merge would use: glab mr merge <number>
      // For now, return unavailable - can be implemented later
      return {
        merged: false,
        status: 502,
        error: 'GitLab MR merging not yet implemented',
      };
    },

    async prDiff(number: number, opts?: { refresh?: boolean }): Promise<ForgePrDiffResult> {
      // GitLab diff would require API calls
      // For now, return unavailable - can be implemented later
      return {
        available: false,
        reason: 'GitLab MR diff not yet implemented',
      };
    },

    viewUrl(kind: ForgeRefKind, ref: string | number): string | null {
      if (!repoRef) return null;
      
      const base = `https://${repoRef.host}/${repoRef.owner}/${repoRef.repo}`;
      
      switch (kind) {
        case 'repo':
          return base;
        case 'issue':
          return `${base}/-/issues/${ref}`;
        case 'pr':
          return `${base}/-/merge_requests/${ref}`;
        case 'branch':
          return `${base}/-/tree/${ref}`;
        case 'commit':
          return `${base}/-/commit/${ref}`;
        default:
          return null;
      }
    },
  };
}

function parseGitlabIssues(output: string): ForgeItem[] {
  // Parse glab issue list output
  // Format is typically table-based, we'll parse it line by line
  const lines = output.trim().split('\n').filter(l => l.trim());
  const items: ForgeItem[] = [];
  
  for (const line of lines) {
    // Skip headers and separators
    if (line.startsWith('#') || line.includes('---') || line.startsWith('Showing')) continue;

    // Basic parsing - format: #123 • Title (label1, label2) • author • created_at
    const match = line.match(/#(\d+)\s+(.+)/);
    if (match) {
      const [, numberStr, rest] = match;
      if (!numberStr || !rest) continue;
      const number = parseInt(numberStr, 10);

      items.push({
        kind: 'issue',
        number,
        title: (rest.trim().split('•')[0] ?? '').trim(),
        author: 'unknown', // Would need API call for details
        createdAt: new Date().toISOString(),
        labels: [],
        body: '',
        url: '', // Would need repo info
        comments: 0,
      });
    }
  }
  
  return items;
}

function parseGitlabMRs(output: string): ForgeItem[] {
  // Parse glab mr list output - similar to issues
  const lines = output.trim().split('\n').filter(l => l.trim());
  const items: ForgeItem[] = [];

  for (const line of lines) {
    if (line.startsWith('!') || line.includes('---') || line.startsWith('Showing')) continue;

    const match = line.match(/!(\d+)\s+(.+)/);
    if (match) {
      const [, numberStr, rest] = match;
      if (!numberStr || !rest) continue;
      const number = parseInt(numberStr, 10);

      items.push({
        kind: 'pr',
        number,
        title: (rest.trim().split('•')[0] ?? '').trim(),
        author: 'unknown',
        createdAt: new Date().toISOString(),
        labels: [],
        body: '',
        url: '',
        comments: 0,
        isDraft: rest.toLowerCase().includes('draft'),
        additions: 0,
        deletions: 0,
        checks: null,
      });
    }
  }
  
  return items;
}

function mockGitlabIssues(): ForgeItem[] {
  return [
    {
      kind: 'issue',
      number: 1,
      title: 'Sample GitLab issue',
      author: 'gitlab-user',
      createdAt: new Date().toISOString(),
      labels: ['bug'],
      body: 'This is a mock issue for dry-run mode',
      url: 'https://gitlab.com/example/repo/-/issues/1',
      comments: 3,
    },
  ];
}

function mockGitlabMRs(): ForgeItem[] {
  return [
    {
      kind: 'pr',
      number: 1,
      title: 'Draft: Sample GitLab MR',
      author: 'gitlab-user',
      createdAt: new Date().toISOString(),
      labels: ['enhancement'],
      body: 'This is a mock MR for dry-run mode',
      url: 'https://gitlab.com/example/repo/-/merge_requests/1',
      comments: 2,
      isDraft: true,
      additions: 10,
      deletions: 5,
      checks: null,
    },
  ];
}
