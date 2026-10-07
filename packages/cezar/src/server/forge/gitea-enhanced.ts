/**
 * Enhanced Gitea/Forgejo forge driver with full parity to GitHub features.
 * Implements prMergeState, mergePR, prDiff, CI checks, and comment counts.
 * 
 * Spec: .ai/specs/2026-10-07-high-priority-improvements.md
 * 
 * Forgejo is a soft fork of Gitea and uses the same CLI (tea) and API.
 */

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
  ForgeMergeMethod,
  ForgeMergeResult,
  ForgePrCheck,
  ForgePrMergeState,
  ForgePrMergeStateResult,
  ForgePrStatus,
  ForgePrDiffResult,
  ForgePrChange,
  ForgeRefKind,
  ForgeSearchData,
} from './types.ts';

const exec = promisify(execFile);

export interface GiteaRepoRef {
  host: string;
  owner: string;
  repo: string;
}

const CACHE_MS = 60_000;
const TEA_MAX_LIMIT = 1000;
const PR_DIFF_FILE_CAP = 300;
const PR_PATCH_CAP = 512 * 1024;

// Gitea API schemas (JSON responses from tea API calls)
const giteaUserSchema = z.object({
  login: z.string(),
  full_name: z.string().optional(),
}).nullish();

const giteaLabelSchema = z.object({
  name: z.string(),
  color: z.string(),
});

const giteaIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  user: giteaUserSchema,
  created_at: z.string(),
  labels: z.array(giteaLabelSchema).default([]),
  body: z.string().nullish(),
  html_url: z.string(),
  comments: z.number().default(0),
});

const giteaPrSchema = giteaIssueSchema.extend({
  draft: z.boolean().default(false),
  mergeable: z.boolean().optional(),
  merged: z.boolean().default(false),
  state: z.string(),
});

// Detailed PR schema for merge state
const giteaPrDetailSchema = z.object({
  number: z.number(),
  title: z.string(),
  html_url: z.string(),
  state: z.string(), // 'open', 'closed'
  draft: z.boolean().default(false),
  head: z.object({
    ref: z.string(),
    sha: z.string(),
  }),
  base: z.object({
    ref: z.string(),
  }),
  mergeable: z.boolean().optional(),
  merged: z.boolean().default(false),
  merge_commit_sha: z.string().nullish(),
  // Gitea doesn't have built-in approvals like GitLab, but custom checks can exist
  // We'll check for status checks via a separate API call
});

// Gitea commit status (CI checks)
const giteaStatusSchema = z.object({
  id: z.number(),
  status: z.string(), // 'pending', 'success', 'error', 'failure', 'warning'
  target_url: z.string().optional(),
  description: z.string().optional(),
  context: z.string(),
  created_at: z.string(),
});

// Diff file schema
const giteaFileSchema = z.object({
  filename: z.string(),
  old_filename: z.string().optional(),
  status: z.string(), // 'added', 'modified', 'removed', 'renamed'
  additions: z.number(),
  deletions: z.number(),
  changes: z.number(),
  patch: z.string().optional(),
  contents_url: z.string().optional(),
});

async function tea(repoRoot: string, args: string[], timeout = 15_000): Promise<string> {
  const { stdout } = await exec('tea', args, {
    cwd: repoRoot,
    timeout,
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout;
}

async function teaApi(repoRoot: string, endpoint: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: string, timeout = 15_000): Promise<string> {
  const args = ['api', endpoint, '--method', method];
  if (body) {
    args.push('--data', body);
  }
  return tea(repoRoot, args, timeout);
}

function firstLine(s: string): string {
  return s.split('\n').find((l) => l.trim().length > 0)?.trim() ?? 'tea failed';
}

const listCache = new Map<string, { at: number; limit: number; data: { issues: ForgeItem[]; prs: ForgeItem[] } }>();
const mergeStateCache = new Map<string, { at: number; data: ForgePrMergeState }>();
const diffCache = new Map<string, { at: number; data: ForgePrDiffResult }>();

let availabilityCache: { at: number; result: ForgeAvailability } | null = null;

async function detectTea(repoRoot: string): Promise<ForgeAvailability> {
  try {
    await tea(repoRoot, ['--version'], 5_000);
    return { available: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reason = /ENOENT/.test(message)
      ? 'tea CLI not found — install it from https://gitea.com/gitea/tea'
      : firstLine(message);
    return { available: false, reason };
  }
}

function mapGiteaStatus(status?: string): 'passing' | 'failing' | 'pending' | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === 'success') return 'passing';
  if (['error', 'failure'].includes(s)) return 'failing';
  if (['pending', 'warning'].includes(s)) return 'pending';
  return null;
}

function mapGiteaStatusToCheck(status: z.infer<typeof giteaStatusSchema>): ForgePrCheck {
  const state = mapGiteaStatus(status.status) ?? 'unknown';
  return {
    name: status.context || 'Check',
    state,
    required: true, // Gitea doesn't expose required vs optional easily
    url: status.target_url,
  };
}

export function createEnhancedGiteaDriver(
  repoRoot: string,
  repoRef: GiteaRepoRef | null,
  forgeKind: 'gitea' | 'forgejo' = 'gitea'
): ForgeDriver {
  const repoPath = repoRef ? `${repoRef.owner}/${repoRef.repo}` : null;

  return {
    kind: forgeKind,

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
      if (process.env.CEZ_DRY_RUN === '1') return mockGiteaIssues(forgeKind);
      
      const capped = Math.min(opts?.limit ?? 30, TEA_MAX_LIMIT);
      const cacheKey = `${repoRoot}\0issues\0${capped}`;
      const hit = listCache.get(cacheKey);
      
      if (!opts?.refresh && hit && Date.now() - hit.at < CACHE_MS && hit.limit >= capped) {
        return hit.data.issues;
      }

      try {
        const args = ['issues', 'list', '--limit', String(capped), '--state', 'open', '--output', 'json'];
        if (repoPath) args.push('--repo', repoPath);
        
        const out = await tea(repoRoot, args);
        const parsed = z.array(giteaIssueSchema).parse(JSON.parse(out));
        const issues = parsed.map((issue): ForgeItem => ({
          kind: 'issue',
          number: issue.number,
          title: issue.title,
          author: issue.user?.login ?? 'unknown',
          createdAt: issue.created_at,
          labels: issue.labels.map(l => l.name),
          body: (issue.body ?? '').slice(0, 8000),
          url: issue.html_url,
          comments: issue.comments,
        }));
        
        listCache.set(cacheKey, {
          at: Date.now(),
          limit: capped,
          data: { issues, prs: hit?.data.prs ?? [] },
        });
        
        return issues;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`${forgeKind} issue list failed: ${firstLine(message)}`);
        return [];
      }
    },

    async listPRs(opts?: ForgeListOptions): Promise<ForgeItem[]> {
      if (process.env.CEZ_DRY_RUN === '1') return mockGiteaPRs(forgeKind);
      
      const capped = Math.min(opts?.limit ?? 30, TEA_MAX_LIMIT);
      const cacheKey = `${repoRoot}\0prs\0${capped}`;
      const hit = listCache.get(cacheKey);
      
      if (!opts?.refresh && hit && Date.now() - hit.at < CACHE_MS && hit.limit >= capped) {
        return hit.data.prs;
      }

      try {
        const args = ['pulls', 'list', '--limit', String(capped), '--state', 'open', '--output', 'json'];
        if (repoPath) args.push('--repo', repoPath);
        
        const out = await tea(repoRoot, args);
        const parsed = z.array(giteaPrSchema).parse(JSON.parse(out));
        const prs = parsed.map((pr): ForgeItem => ({
          kind: 'pr',
          number: pr.number,
          title: pr.title,
          author: pr.user?.login ?? 'unknown',
          createdAt: pr.created_at,
          labels: pr.labels.map(l => l.name),
          body: (pr.body ?? '').slice(0, 8000),
          url: pr.html_url,
          comments: pr.comments,
          isDraft: pr.draft,
          checks: null, // Populated on-demand
        }));
        
        listCache.set(cacheKey, {
          at: Date.now(),
          limit: capped,
          data: { issues: hit?.data.issues ?? [], prs },
        });
        
        return prs;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`${forgeKind} PR list failed: ${firstLine(message)}`);
        return [];
      }
    },

    async searchItems(kind: 'issue' | 'pr', query: string, opts?: { limit?: number }): Promise<ForgeSearchData> {
      if (process.env.CEZ_DRY_RUN === '1') {
        return { 
          available: true, 
          items: kind === 'issue' ? mockGiteaIssues(forgeKind) : mockGiteaPRs(forgeKind), 
          truncated: false 
        };
      }

      if (!repoPath) {
        return {
          available: false,
          reason: 'Repository path not determined',
          items: [],
        };
      }

      try {
        const capped = Math.min(opts?.limit ?? 50, 100);
        
        // Use Gitea search API
        const endpoint = kind === 'issue' 
          ? `/repos/${repoPath}/issues?q=${encodeURIComponent(query)}&limit=${capped}`
          : `/repos/${repoPath}/pulls?q=${encodeURIComponent(query)}&limit=${capped}`;
        
        const out = await teaApi(repoRoot, endpoint, 'GET', undefined, 30_000);
        const parsed = z.array(kind === 'issue' ? giteaIssueSchema : giteaPrSchema).parse(JSON.parse(out));
        
        const items = parsed.map((item): ForgeItem => ({
          kind,
          number: item.number,
          title: item.title,
          author: item.user?.login ?? 'unknown',
          createdAt: item.created_at,
          labels: item.labels.map(l => l.name),
          body: (item.body ?? '').slice(0, 8000),
          url: item.html_url,
          comments: item.comments,
          ...('draft' in item && typeof item.draft === 'boolean' ? { isDraft: item.draft, checks: null } : {}),
        }));
        
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
        return { 
          ok: true, 
          url: `https://${repoRef?.host}/${repoRef?.owner}/${repoRef?.repo}/pulls/1`, 
          dryRun: true 
        };
      }

      try {
        const title = input.run.title || 'Task completion';
        const finalTitle = title.startsWith('[Draft]') || title.startsWith('Draft:') 
          ? title 
          : `[Draft] ${title}`;
        
        const args = [
          'pulls', 'create',
          '--title', finalTitle,
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

      if (!repoPath) return null;

      try {
        const endpoint = `/repos/${repoPath}/pulls?state=open&head=${encodeURIComponent(branch)}`;
        const out = await teaApi(repoRoot, endpoint, 'GET', undefined, 10_000);
        const parsed = z.array(giteaPrSchema).parse(JSON.parse(out));
        
        if (parsed.length === 0) return null;

        const pr = parsed[0];
        if (!pr) {
          return null;
        }
        const state = pr.merged ? 'merged' : pr.state === 'open' ? 'open' : 'closed';

        return {
          number: pr.number,
          url: pr.html_url,
          state,
          isDraft: pr.draft,
          checks: null,
        };
      } catch {
        return null;
      }
    },

    async prMergeState(number: number, opts?: { refresh?: boolean }): Promise<ForgePrMergeStateResult> {
      if (process.env.CEZ_DRY_RUN === '1') {
        return {
          available: true,
          mergeState: mockGiteaMergeState(number, forgeKind),
        };
      }

      if (!repoPath) {
        return { available: false, reason: 'Repository path could not be determined' };
      }

      const cacheKey = `${repoRoot}\0pr-merge\0${number}`;
      const hit = mergeStateCache.get(cacheKey);
      if (!opts?.refresh && hit && Date.now() - hit.at < CACHE_MS) {
        return { available: true, mergeState: hit.data };
      }

      try {
        // Fetch PR details
        const prOut = await teaApi(repoRoot, `/repos/${repoPath}/pulls/${number}`);
        const pr = giteaPrDetailSchema.parse(JSON.parse(prOut));
        
        // Fetch commit statuses (CI checks)
        const checks: ForgePrCheck[] = [];
        let checksTier: 'detailed' | 'aggregate' | 'none' = 'none';
        let checksReason: string | undefined;
        
        try {
          const statusOut = await teaApi(repoRoot, `/repos/${repoPath}/statuses/${pr.head.sha}`);
          const statuses = z.array(giteaStatusSchema).parse(JSON.parse(statusOut));
          
          if (statuses.length > 0) {
            // Group by context (multiple statuses can exist for same check)
            const latestByContext = new Map<string, z.infer<typeof giteaStatusSchema>>();
            for (const status of statuses) {
              const existing = latestByContext.get(status.context);
              if (!existing || new Date(status.created_at) > new Date(existing.created_at)) {
                latestByContext.set(status.context, status);
              }
            }
            
            checks.push(...Array.from(latestByContext.values()).map(mapGiteaStatusToCheck));
            checksTier = 'detailed';
          }
        } catch (err) {
          checksReason = 'Could not fetch commit statuses';
        }
        
        // Determine mergeable status
        let mergeable: 'mergeable' | 'conflicting' | 'unknown' = 'unknown';
        if (pr.mergeable === true) mergeable = 'mergeable';
        else if (pr.mergeable === false) mergeable = 'conflicting';
        
        // Determine eligibility and blockers
        const blockers: Array<{ code: string; message: string }> = [];
        
        if (pr.draft) {
          blockers.push({ code: 'draft', message: 'PR is marked as draft' });
        }
        
        if (pr.mergeable === false) {
          blockers.push({ code: 'conflicts', message: 'Merge conflicts must be resolved' });
        }
        
        // Check if any CI checks are failing
        const failingChecks = checks.filter(c => c.state === 'failing');
        if (failingChecks.length > 0) {
          blockers.push({ 
            code: 'ci', 
            message: `${failingChecks.length} check(s) failing` 
          });
        }
        
        const pendingChecks = checks.filter(c => c.state === 'pending');
        if (pendingChecks.length > 0 && failingChecks.length === 0) {
          blockers.push({ 
            code: 'ci_pending', 
            message: `${pendingChecks.length} check(s) pending` 
          });
        }
        
        // Determine eligibility
        let eligibility: 'ready' | 'blocked' | 'pending' | 'unauthorized' | 'terminal' | 'unknown' = 'unknown';
        if (pr.state !== 'open') {
          eligibility = 'terminal';
        } else if (blockers.length === 0) {
          eligibility = 'ready';
        } else if (blockers.some(b => b.code === 'ci_pending')) {
          eligibility = 'pending';
        } else {
          eligibility = 'blocked';
        }
        
        const canMerge = eligibility === 'ready' && mergeable === 'mergeable';
        
        // Review decision - Gitea doesn't have formal review approval system
        const reviewDecision: 'approved' | 'changes-requested' | 'review-required' | 'unknown' = 'unknown';
        
        // Available merge methods
        const methods: ForgeMergeMethod[] = ['merge', 'squash', 'rebase'];
        
        const mergeState: ForgePrMergeState = {
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          state: pr.merged ? 'merged' : pr.state === 'open' ? 'open' : 'closed',
          isDraft: pr.draft,
          headRef: pr.head.ref,
          baseRef: pr.base.ref,
          headSha: pr.head.sha,
          mergeable,
          reviewDecision,
          checks,
          checksTier,
          ...(checksReason ? { checksReason } : {}),
          methods,
          defaultMethod: 'merge',
          eligibility,
          blockers,
          canMerge,
          canOverride: false,
        };
        
        mergeStateCache.set(cacheKey, { at: Date.now(), data: mergeState });
        return { available: true, mergeState };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          available: false,
          reason: /404|not found/i.test(message)
            ? `Pull request #${number} was not found`
            : firstLine(message),
        };
      }
    },

    async mergePR(number: number, input: ForgeMergeInput): Promise<ForgeMergeResult> {
      if (process.env.CEZ_DRY_RUN === '1') {
        return {
          merged: true,
          number,
          url: `https://${repoRef?.host}/${repoRef?.owner}/${repoRef?.repo}/pulls/${number}`,
          method: input.method,
          mergeCommitSha: '0123456789abcdef0123456789abcdef01234567',
        };
      }

      if (!repoPath) {
        return {
          merged: false,
          status: 502,
          error: 'Repository path could not be determined',
        };
      }

      try {
        // Verify current head SHA
        const currentState = await this.prMergeState!(number, { refresh: true });
        if (!currentState.available) {
          return {
            merged: false,
            status: 502,
            error: currentState.reason,
          };
        }
        
        if (currentState.mergeState.headSha !== input.expectedHeadSha) {
          return {
            merged: false,
            status: 409,
            error: 'The pull request has been updated since you last viewed it',
            code: 'head_changed',
            current: currentState.mergeState,
          };
        }
        
        if (!currentState.mergeState.canMerge && !input.overrideRules) {
          return {
            merged: false,
            status: 409,
            error: 'Merge is blocked by one or more checks',
            code: 'blocked',
            current: currentState.mergeState,
          };
        }
        
        // Determine merge style from method
        let mergeStyle = 'merge';
        if (input.method === 'squash') mergeStyle = 'squash';
        else if (input.method === 'rebase') mergeStyle = 'rebase';
        
        // Perform merge via API
        const body = JSON.stringify({
          Do: mergeStyle,
          MergeMessageField: '',
          MergeTitleField: '',
        });
        
        const out = await teaApi(
          repoRoot, 
          `/repos/${repoPath}/pulls/${number}/merge`, 
          'POST',
          body,
          30_000
        );
        
        // Check if merge succeeded
        const result = JSON.parse(out);
        if (result.merged || result.sha) {
          return {
            merged: true,
            number,
            url: currentState.mergeState.url,
            method: input.method,
            mergeCommitSha: result.sha,
          };
        }
        
        return {
          merged: false,
          status: 502,
          error: 'Merge command completed but status unclear',
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        
        if (/403|unauthorized|forbidden/i.test(message)) {
          return {
            merged: false,
            status: 403,
            error: 'You do not have permission to merge this PR',
          };
        }
        
        if (/404|not found/i.test(message)) {
          return {
            merged: false,
            status: 404,
            error: `Pull request #${number} was not found`,
          };
        }
        
        if (/conflict/i.test(message)) {
          return {
            merged: false,
            status: 409,
            error: 'Merge conflicts must be resolved',
            code: 'conflicts',
          };
        }
        
        return {
          merged: false,
          status: 502,
          error: firstLine(message),
        };
      }
    },

    async prDiff(number: number, opts?: { refresh?: boolean }): Promise<ForgePrDiffResult> {
      if (process.env.CEZ_DRY_RUN === '1') {
        return mockGiteaPrDiff(number, forgeKind);
      }

      if (!repoPath) {
        return { available: false, reason: 'Repository path could not be determined' };
      }

      const cacheKey = `${repoRoot}\0pr-diff\0${number}`;
      const hit = diffCache.get(cacheKey);
      if (!opts?.refresh && hit && Date.now() - hit.at < CACHE_MS) {
        return hit.data;
      }

      try {
        // Fetch PR to get head SHA
        const prOut = await teaApi(repoRoot, `/repos/${repoPath}/pulls/${number}`);
        const pr = giteaPrDetailSchema.parse(JSON.parse(prOut));
        
        // Fetch file changes
        const filesOut = await teaApi(repoRoot, `/repos/${repoPath}/pulls/${number}/files`, 'GET', undefined, 30_000);
        const allFiles = z.array(giteaFileSchema).parse(JSON.parse(filesOut));
        
        const files: ForgePrChange[] = [];
        let totalAdditions = 0;
        let totalDeletions = 0;
        let responseTruncated = false;
        const reasons: string[] = [];
        
        for (const file of allFiles.slice(0, PR_DIFF_FILE_CAP)) {
          totalAdditions += file.additions;
          totalDeletions += file.deletions;
          
          // Map Gitea status to our format
          let status: ForgePrChange['status'] = 'modified';
          if (file.status === 'added') status = 'added';
          else if (file.status === 'removed' || file.status === 'deleted') status = 'removed';
          else if (file.status === 'renamed') status = 'renamed';
          
          // Handle patch
          let patch: string | undefined = file.patch;
          let patchUnavailableReason: 'binary' | 'too-large' | 'not-provided' | undefined;
          let truncated = false;
          
          if (patch && Buffer.byteLength(patch, 'utf8') > PR_PATCH_CAP) {
            patch = undefined;
            patchUnavailableReason = 'too-large';
            truncated = true;
            responseTruncated = true;
          } else if (!patch || patch.length === 0) {
            patch = undefined;
            patchUnavailableReason = file.additions === 0 && file.deletions === 0 ? 'binary' : 'not-provided';
          }
          
          files.push({
            path: file.filename,
            ...(file.old_filename && file.old_filename !== file.filename ? { previousPath: file.old_filename } : {}),
            status,
            additions: file.additions,
            deletions: file.deletions,
            ...(patch ? { patch } : {}),
            ...(patchUnavailableReason ? { patchUnavailableReason } : {}),
            ...(truncated ? { truncated } : {}),
          });
        }
        
        if (allFiles.length > PR_DIFF_FILE_CAP) {
          responseTruncated = true;
          reasons.push(`Only the first ${PR_DIFF_FILE_CAP} files are shown.`);
        }
        
        if (files.some(f => f.truncated)) {
          reasons.push('One or more patches exceeded the per-file limit.');
        }
        
        const result: ForgePrDiffResult = {
          available: true,
          number,
          headSha: pr.head.sha,
          files,
          additions: totalAdditions,
          deletions: totalDeletions,
          truncated: responseTruncated,
          ...(reasons.length ? { reason: reasons.join(' ') } : {}),
        };
        
        diffCache.set(cacheKey, { at: Date.now(), data: result });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        
        if (/404|not found/i.test(message)) {
          return {
            available: false,
            reason: `Pull request #${number} was not found`,
          };
        }
        
        return {
          available: false,
          reason: /ENOENT/.test(message)
            ? 'tea CLI not found — install it and authenticate'
            : firstLine(message),
        };
      }
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

// Helper to create Forgejo driver (same as Gitea, just different kind)
export function createEnhancedForgejoDriver(repoRoot: string, repoRef: GiteaRepoRef | null): ForgeDriver {
  return createEnhancedGiteaDriver(repoRoot, repoRef, 'forgejo');
}

// Mock data for dry-run mode
function mockGiteaIssues(kind: 'gitea' | 'forgejo'): ForgeItem[] {
  const host = kind === 'gitea' ? 'gitea.com' : 'codeberg.org';
  return [
    {
      kind: 'issue',
      number: 1,
      title: `Sample ${kind} issue`,
      author: `${kind}-user`,
      createdAt: new Date().toISOString(),
      labels: ['bug'],
      body: 'This is a mock issue for dry-run mode',
      url: `https://${host}/example/repo/issues/1`,
      comments: 2,
    },
  ];
}

function mockGiteaPRs(kind: 'gitea' | 'forgejo'): ForgeItem[] {
  const host = kind === 'gitea' ? 'gitea.com' : 'codeberg.org';
  return [
    {
      kind: 'pr',
      number: 1,
      title: `[Draft] Sample ${kind} PR`,
      author: `${kind}-user`,
      createdAt: new Date().toISOString(),
      labels: ['enhancement'],
      body: 'This is a mock PR for dry-run mode',
      url: `https://${host}/example/repo/pulls/1`,
      comments: 1,
      isDraft: true,
      additions: 15,
      deletions: 3,
      checks: null,
    },
  ];
}

function mockGiteaMergeState(number: number, kind: 'gitea' | 'forgejo'): ForgePrMergeState {
  const host = kind === 'gitea' ? 'gitea.com' : 'codeberg.org';
  return {
    number,
    title: `Sample ${kind} PR`,
    url: `https://${host}/example/repo/pulls/${number}`,
    state: 'open',
    isDraft: false,
    headRef: 'feature/sample',
    baseRef: 'main',
    headSha: '0123456789abcdef0123456789abcdef01234567',
    mergeable: 'mergeable',
    reviewDecision: 'unknown',
    checks: [
      { name: 'ci/test', state: 'passing', required: true },
      { name: 'ci/lint', state: 'passing', required: true },
    ],
    checksTier: 'detailed',
    methods: ['merge', 'squash', 'rebase'],
    defaultMethod: 'merge',
    eligibility: 'ready',
    blockers: [],
    canMerge: true,
    canOverride: false,
  };
}

function mockGiteaPrDiff(number: number, kind: 'gitea' | 'forgejo'): ForgePrDiffResult {
  return {
    available: true,
    number,
    headSha: '0123456789abcdef0123456789abcdef01234567',
    additions: 20,
    deletions: 6,
    truncated: false,
    files: [
      {
        path: 'src/main.go',
        status: 'modified',
        additions: 12,
        deletions: 4,
        patch: '@@ -1,8 +1,12 @@\n package main\n\n import (\n-\t"fmt"\n+\t"fmt"\n+\t"log"\n )\n\n func main() {\n-\tfmt.Println("Hello")\n+\tlog.Println("Hello, world!")\n }',
      },
      {
        path: 'README.md',
        status: 'modified',
        additions: 8,
        deletions: 2,
        patch: '@@ -1,5 +1,11 @@\n # Project\n\n-A simple project.\n+A simple Go project demonstrating features.\n+\n+## Features\n+- Logging\n+- Error handling',
      },
    ],
  };
}
