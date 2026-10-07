/**
 * Enhanced GitLab forge driver with full parity to GitHub features.
 * Implements prMergeState, mergePR, prDiff, CI checks, and comment counts.
 * 
 * Spec: .ai/specs/2026-10-07-high-priority-improvements.md
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

export interface GitlabRepoRef {
  host: string;
  owner: string;
  repo: string;
}

const CACHE_MS = 60_000;
const GLAB_MAX_LIMIT = 1000;
const MR_DIFF_FILE_CAP = 300;
const MR_PATCH_CAP = 512 * 1024;

// GitLab API schemas
const glabAuthor = z.object({ username: z.string() }).nullish();
const glabLabel = z.object({ name: z.string(), color: z.string().default('') });

const glabIssueSchema = z.object({
  iid: z.number(),
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
  state: z.string().optional(),
  merge_status: z.string().optional(),
  detailed_merge_status: z.string().optional(),
});

// Merge state schemas
const glabPipelineSchema = z.object({
  id: z.number(),
  status: z.string(),
  ref: z.string(),
  sha: z.string(),
  web_url: z.string().optional(),
});

const glabJobSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(),
  stage: z.string().optional(),
  web_url: z.string().optional(),
  allow_failure: z.boolean().default(false),
});

const glabMrDetailSchema = z.object({
  iid: z.number(),
  title: z.string(),
  web_url: z.string(),
  state: z.string(),
  draft: z.boolean().default(false),
  source_branch: z.string(),
  target_branch: z.string(),
  sha: z.string(),
  merge_status: z.string().optional(),
  detailed_merge_status: z.string().optional(),
  mergeable: z.boolean().optional(),
  has_conflicts: z.boolean().default(false),
  blocking_discussions_resolved: z.boolean().default(true),
  approvals_before_merge: z.number().optional(),
  approved: z.boolean().optional(),
  approved_by: z.array(z.object({ user: z.object({ username: z.string() }) })).optional(),
  head_pipeline: glabPipelineSchema.nullish(),
  squash: z.boolean().default(false),
  rebase_in_progress: z.boolean().default(false),
});

// Diff schemas
const glabDiffSchema = z.object({
  old_path: z.string(),
  new_path: z.string(),
  a_mode: z.string().optional(),
  b_mode: z.string().optional(),
  new_file: z.boolean(),
  renamed_file: z.boolean(),
  deleted_file: z.boolean(),
  diff: z.string(),
});

const glabMrChangesSchema = z.object({
  iid: z.number(),
  sha: z.string(),
  changes: z.array(glabDiffSchema),
});

async function glab(repoRoot: string, args: string[], timeout = 15_000): Promise<string> {
  const { stdout } = await exec('glab', args, {
    cwd: repoRoot,
    timeout,
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout;
}

async function glabApi(repoRoot: string, endpoint: string, timeout = 15_000): Promise<string> {
  return glab(repoRoot, ['api', endpoint], timeout);
}

function firstLine(s: string): string {
  return s.split('\n').find((l) => l.trim().length > 0)?.trim() ?? 'glab failed';
}

const listCache = new Map<string, { at: number; limit: number; data: { issues: ForgeItem[]; prs: ForgeItem[] } }>();
const mergeStateCache = new Map<string, { at: number; data: ForgePrMergeState }>();
const diffCache = new Map<string, { at: number; data: ForgePrDiffResult }>();

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

function mapGitlabPipelineStatus(status?: string): 'passing' | 'failing' | 'pending' | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (['success', 'passed'].includes(s)) return 'passing';
  if (['failed', 'canceled', 'skipped'].includes(s)) return 'failing';
  if (['pending', 'running', 'created', 'waiting_for_resource', 'preparing'].includes(s)) return 'pending';
  return null;
}

function mapGitlabJobToCheck(job: z.infer<typeof glabJobSchema>): ForgePrCheck {
  const state = mapGitlabPipelineStatus(job.status) ?? 'unknown';
  return {
    name: job.name,
    state,
    required: !job.allow_failure,
    url: job.web_url,
  };
}

function mapMergeStatus(mr: z.infer<typeof glabMrDetailSchema>): {
  mergeable: 'mergeable' | 'conflicting' | 'unknown';
  eligibility: 'ready' | 'blocked' | 'pending' | 'unauthorized' | 'terminal' | 'unknown';
  blockers: Array<{ code: string; message: string }>;
  canMerge: boolean;
} {
  const blockers: Array<{ code: string; message: string }> = [];
  
  // Check conflicts
  if (mr.has_conflicts) {
    blockers.push({ code: 'conflicts', message: 'Merge conflicts must be resolved' });
  }
  
  // Check discussions
  if (!mr.blocking_discussions_resolved) {
    blockers.push({ code: 'discussions', message: 'Blocking discussions must be resolved' });
  }
  
  // Check approvals
  if (mr.approvals_before_merge && mr.approvals_before_merge > 0) {
    const approvedCount = mr.approved_by?.length ?? 0;
    if (approvedCount < mr.approvals_before_merge) {
      blockers.push({
        code: 'approvals',
        message: `Needs ${mr.approvals_before_merge - approvedCount} more approval(s)`,
      });
    }
  }
  
  // Check pipeline
  if (mr.head_pipeline) {
    const pipelineStatus = mr.head_pipeline.status.toLowerCase();
    if (['failed', 'canceled'].includes(pipelineStatus)) {
      blockers.push({ code: 'ci', message: 'CI pipeline must pass' });
    } else if (['pending', 'running', 'created'].includes(pipelineStatus)) {
      blockers.push({ code: 'ci_pending', message: 'CI pipeline is still running' });
    }
  }
  
  // Check draft status
  if (mr.draft) {
    blockers.push({ code: 'draft', message: 'MR is marked as draft' });
  }
  
  // Determine mergeable status
  let mergeable: 'mergeable' | 'conflicting' | 'unknown' = 'unknown';
  if (mr.mergeable === true) mergeable = 'mergeable';
  else if (mr.mergeable === false || mr.has_conflicts) mergeable = 'conflicting';
  
  // Determine eligibility
  let eligibility: 'ready' | 'blocked' | 'pending' | 'unauthorized' | 'terminal' | 'unknown' = 'unknown';
  if (mr.state !== 'opened') {
    eligibility = 'terminal';
  } else if (blockers.length === 0) {
    eligibility = 'ready';
  } else if (blockers.some(b => b.code === 'ci_pending')) {
    eligibility = 'pending';
  } else {
    eligibility = 'blocked';
  }
  
  const canMerge = eligibility === 'ready' && mergeable === 'mergeable';
  
  return { mergeable, eligibility, blockers, canMerge };
}

export function createEnhancedGitlabDriver(repoRoot: string, repoRef: GitlabRepoRef | null): ForgeDriver {
  const projectPath = repoRef ? `${repoRef.owner}/${repoRef.repo}` : null;
  const projectId = projectPath ? encodeURIComponent(projectPath) : null;

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
        const args = ['issue', 'list', '--per-page', String(capped), '--output', 'json'];
        if (projectPath) args.push('--repo', projectPath);
        
        const out = await glab(repoRoot, args);
        const parsed = z.array(glabIssueSchema).parse(JSON.parse(out));
        const issues = parsed.map((issue): ForgeItem => ({
          kind: 'issue',
          number: issue.iid,
          title: issue.title,
          author: issue.author?.username ?? 'unknown',
          createdAt: issue.created_at,
          labels: issue.labels,
          body: (issue.description ?? '').slice(0, 8000),
          url: issue.web_url,
          comments: issue.user_notes_count,
        }));
        
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
        const args = ['mr', 'list', '--per-page', String(capped), '--output', 'json'];
        if (projectPath) args.push('--repo', projectPath);
        
        const out = await glab(repoRoot, args);
        const parsed = z.array(glabMrSchema).parse(JSON.parse(out));
        const prs = parsed.map((mr): ForgeItem => ({
          kind: 'pr',
          number: mr.iid,
          title: mr.title,
          author: mr.author?.username ?? 'unknown',
          createdAt: mr.created_at,
          labels: mr.labels,
          body: (mr.description ?? '').slice(0, 8000),
          url: mr.web_url,
          comments: mr.user_notes_count,
          isDraft: mr.draft,
          checks: null, // Populated lazily on-demand
        }));
        
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
          ? ['issue', 'list', '--search', query, '--per-page', String(capped), '--output', 'json']
          : ['mr', 'list', '--search', query, '--per-page', String(capped), '--output', 'json'];
        
        if (projectPath) args.push('--repo', projectPath);
        
        const out = await glab(repoRoot, args, 30_000);
        const parsed = kind === 'issue'
          ? z.array(glabIssueSchema).parse(JSON.parse(out))
          : z.array(glabMrSchema).parse(JSON.parse(out));
        
        const items = parsed.map((item): ForgeItem => ({
          kind,
          number: item.iid,
          title: item.title,
          author: item.author?.username ?? 'unknown',
          createdAt: item.created_at,
          labels: item.labels,
          body: (item.description ?? '').slice(0, 8000),
          url: item.web_url,
          comments: item.user_notes_count,
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
        return { ok: true, url: `https://${repoRef?.host}/${repoRef?.owner}/${repoRef?.repo}/-/merge_requests/1`, dryRun: true };
      }

      try {
        const args = [
          'mr', 'create',
          '--title', input.run.title || 'Draft: Task completion',
          '--description', input.handoffText,
          '--draft',
          '--yes',
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
        const args = ['mr', 'list', '--source-branch', branch, '--per-page', '1', '--output', 'json'];
        if (projectPath) args.push('--repo', projectPath);
        
        const out = await glab(repoRoot, args, 10_000);
        const parsed = z.array(glabMrSchema).parse(JSON.parse(out));
        
        if (parsed.length === 0) return null;

        const mr = parsed[0];
        if (!mr) {
          return null;
        }
        const state = mr.state === 'opened' ? 'open' : mr.state === 'merged' ? 'merged' : 'closed';

        return {
          number: mr.iid,
          url: mr.web_url,
          state,
          isDraft: mr.draft,
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
          mergeState: mockGitlabMergeState(number),
        };
      }

      if (!projectId) {
        return { available: false, reason: 'Project path could not be determined' };
      }

      const cacheKey = `${repoRoot}\0mr-merge\0${number}`;
      const hit = mergeStateCache.get(cacheKey);
      if (!opts?.refresh && hit && Date.now() - hit.at < CACHE_MS) {
        return { available: true, mergeState: hit.data };
      }

      try {
        // Fetch MR details
        const mrOut = await glabApi(repoRoot, `/projects/${projectId}/merge_requests/${number}`, 15_000);
        const mr = glabMrDetailSchema.parse(JSON.parse(mrOut));
        
        // Fetch pipeline jobs if pipeline exists
        const checks: ForgePrCheck[] = [];
        let checksTier: 'detailed' | 'aggregate' | 'none' = 'none';
        let checksReason: string | undefined;
        
        if (mr.head_pipeline) {
          try {
            const jobsOut = await glabApi(
              repoRoot,
              `/projects/${projectId}/pipelines/${mr.head_pipeline.id}/jobs`,
              10_000
            );
            const jobs = z.array(glabJobSchema).parse(JSON.parse(jobsOut));
            checks.push(...jobs.map(mapGitlabJobToCheck));
            checksTier = 'detailed';
          } catch (err) {
            // Fall back to aggregate pipeline status
            const pipelineState = mapGitlabPipelineStatus(mr.head_pipeline.status) ?? 'unknown';
            checks.push({
              name: 'Pipeline',
              state: pipelineState,
              required: true,
              url: mr.head_pipeline.web_url,
            });
            checksTier = 'aggregate';
            checksReason = 'Could not fetch individual job details';
          }
        }
        
        // Determine review decision
        let reviewDecision: 'approved' | 'changes-requested' | 'review-required' | 'unknown' = 'unknown';
        if (mr.approved) {
          reviewDecision = 'approved';
        } else if (mr.approvals_before_merge && mr.approvals_before_merge > 0) {
          reviewDecision = 'review-required';
        }
        
        // Map merge status
        const { mergeable, eligibility, blockers, canMerge } = mapMergeStatus(mr);
        
        // Determine available merge methods
        const methods: ForgeMergeMethod[] = ['merge'];
        if (mr.squash) methods.push('squash');
        methods.push('rebase');
        
        const mergeState: ForgePrMergeState = {
          number: mr.iid,
          title: mr.title,
          url: mr.web_url,
          state: mr.state === 'opened' ? 'open' : mr.state === 'merged' ? 'merged' : 'closed',
          isDraft: mr.draft,
          headRef: mr.source_branch,
          baseRef: mr.target_branch,
          headSha: mr.sha,
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
          canOverride: false, // GitLab doesn't support override via CLI
        };
        
        mergeStateCache.set(cacheKey, { at: Date.now(), data: mergeState });
        return { available: true, mergeState };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          available: false,
          reason: /404|not found/i.test(message)
            ? `Merge request !${number} was not found`
            : firstLine(message),
        };
      }
    },

    async mergePR(number: number, input: ForgeMergeInput): Promise<ForgeMergeResult> {
      if (process.env.CEZ_DRY_RUN === '1') {
        return {
          merged: true,
          number,
          url: `https://${repoRef?.host}/${repoRef?.owner}/${repoRef?.repo}/-/merge_requests/${number}`,
          method: input.method,
          mergeCommitSha: '0123456789abcdef0123456789abcdef01234567',
        };
      }

      if (!projectId) {
        return {
          merged: false,
          status: 502,
          error: 'Project path could not be determined',
        };
      }

      try {
        // Verify current head SHA matches expected
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
            error: 'The merge request has been updated since you last viewed it',
            code: 'head_changed',
            current: currentState.mergeState,
          };
        }
        
        // Check if merge is allowed
        if (!currentState.mergeState.canMerge && !input.overrideRules) {
          return {
            merged: false,
            status: 409,
            error: 'Merge is blocked by one or more checks',
            code: 'blocked',
            current: currentState.mergeState,
          };
        }
        
        // Perform merge via glab
        const args = ['mr', 'merge', String(number), '--yes'];
        
        // Add merge method flag
        if (input.method === 'squash') {
          args.push('--squash');
        } else if (input.method === 'rebase') {
          args.push('--rebase');
        }
        
        const out = await glab(repoRoot, args, 30_000);
        
        // Parse merge result
        if (out.includes('Merged') || out.includes('merged')) {
          // Fetch updated MR to get merge commit SHA
          const mrOut = await glabApi(repoRoot, `/projects/${projectId}/merge_requests/${number}`, 10_000);
          const mr = glabMrDetailSchema.parse(JSON.parse(mrOut));
          
          return {
            merged: true,
            number,
            url: mr.web_url,
            method: input.method,
            mergeCommitSha: mr.sha,
          };
        }
        
        return {
          merged: false,
          status: 502,
          error: 'Merge command completed but merge status unclear',
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        
        if (/401|unauthorized/i.test(message)) {
          return {
            merged: false,
            status: 403,
            error: 'You do not have permission to merge this MR',
          };
        }
        
        if (/404|not found/i.test(message)) {
          return {
            merged: false,
            status: 404,
            error: `Merge request !${number} was not found`,
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
        return mockGitlabMrDiff(number);
      }

      if (!projectId) {
        return { available: false, reason: 'Project path could not be determined' };
      }

      const cacheKey = `${repoRoot}\0mr-diff\0${number}`;
      const hit = diffCache.get(cacheKey);
      if (!opts?.refresh && hit && Date.now() - hit.at < CACHE_MS) {
        return hit.data;
      }

      try {
        // Fetch MR changes via API
        const changesOut = await glabApi(repoRoot, `/projects/${projectId}/merge_requests/${number}/changes`, 30_000);
        const mrChanges = glabMrChangesSchema.parse(JSON.parse(changesOut));
        
        const files: ForgePrChange[] = [];
        let totalAdditions = 0;
        let totalDeletions = 0;
        let responseTruncated = false;
        const reasons: string[] = [];
        
        for (const change of mrChanges.changes.slice(0, MR_DIFF_FILE_CAP)) {
          const isNew = change.new_file;
          const isDeleted = change.deleted_file;
          const isRenamed = change.renamed_file;
          
          let status: ForgePrChange['status'] = 'modified';
          if (isNew) status = 'added';
          else if (isDeleted) status = 'removed';
          else if (isRenamed) status = 'renamed';
          
          // Parse diff to count additions/deletions
          const diffLines = change.diff.split('\n');
          let additions = 0;
          let deletions = 0;
          
          for (const line of diffLines) {
            if (line.startsWith('+') && !line.startsWith('+++')) additions++;
            else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
          }
          
          totalAdditions += additions;
          totalDeletions += deletions;
          
          // Check if patch is too large
          let patch: string | undefined = change.diff;
          let patchUnavailableReason: 'binary' | 'too-large' | 'not-provided' | undefined;
          let truncated = false;
          
          if (Buffer.byteLength(patch, 'utf8') > MR_PATCH_CAP) {
            patch = undefined;
            patchUnavailableReason = 'too-large';
            truncated = true;
            responseTruncated = true;
          } else if (!patch || patch.length === 0) {
            patch = undefined;
            patchUnavailableReason = additions === 0 && deletions === 0 ? 'binary' : 'not-provided';
          }
          
          files.push({
            path: change.new_path,
            ...(change.old_path !== change.new_path ? { previousPath: change.old_path } : {}),
            status,
            additions,
            deletions,
            ...(patch ? { patch } : {}),
            ...(patchUnavailableReason ? { patchUnavailableReason } : {}),
            ...(truncated ? { truncated } : {}),
          });
        }
        
        if (mrChanges.changes.length > MR_DIFF_FILE_CAP) {
          responseTruncated = true;
          reasons.push(`Only the first ${MR_DIFF_FILE_CAP} files are shown.`);
        }
        
        if (files.some(f => f.truncated)) {
          reasons.push('One or more patches exceeded the per-file limit.');
        }
        
        const result: ForgePrDiffResult = {
          available: true,
          number,
          headSha: mrChanges.sha,
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
            reason: `Merge request !${number} was not found`,
          };
        }
        
        return {
          available: false,
          reason: /ENOENT/.test(message)
            ? 'glab CLI not found — install it and authenticate'
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

// Mock data for dry-run mode
function mockGitlabIssues(): ForgeItem[] {
  return [
    {
      kind: 'issue',
      number: 1,
      title: 'Sample GitLab issue',
      author: 'gitlab-user',
      createdAt: new Date().toISOString(),
      labels: ['bug', 'high-priority'],
      body: 'This is a mock issue for dry-run mode',
      url: 'https://gitlab.com/example/repo/-/issues/1',
      comments: 3,
    },
    {
      kind: 'issue',
      number: 2,
      title: 'Another test issue',
      author: 'contributor',
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      labels: ['enhancement'],
      body: 'Feature request example',
      url: 'https://gitlab.com/example/repo/-/issues/2',
      comments: 1,
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
      labels: ['enhancement', 'needs-review'],
      body: 'This is a mock MR for dry-run mode',
      url: 'https://gitlab.com/example/repo/-/merge_requests/1',
      comments: 2,
      isDraft: true,
      additions: 15,
      deletions: 3,
      checks: 'pending',
    },
    {
      kind: 'pr',
      number: 2,
      title: 'Fix authentication bug',
      author: 'maintainer',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      labels: ['bug'],
      body: 'Resolves authentication issue',
      url: 'https://gitlab.com/example/repo/-/merge_requests/2',
      comments: 5,
      isDraft: false,
      additions: 42,
      deletions: 18,
      checks: 'passing',
    },
  ];
}

function mockGitlabMergeState(number: number): ForgePrMergeState {
  return {
    number,
    title: 'Sample GitLab MR',
    url: `https://gitlab.com/example/repo/-/merge_requests/${number}`,
    state: 'open',
    isDraft: false,
    headRef: 'feature/sample',
    baseRef: 'main',
    headSha: '0123456789abcdef0123456789abcdef01234567',
    mergeable: 'mergeable',
    reviewDecision: 'approved',
    checks: [
      { name: 'test', state: 'passing', required: true },
      { name: 'lint', state: 'passing', required: true },
      { name: 'build', state: 'passing', required: false },
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

function mockGitlabMrDiff(number: number): ForgePrDiffResult {
  return {
    available: true,
    number,
    headSha: '0123456789abcdef0123456789abcdef01234567',
    additions: 25,
    deletions: 8,
    truncated: false,
    files: [
      {
        path: 'src/auth.ts',
        status: 'modified',
        additions: 15,
        deletions: 5,
        patch: '@@ -1,10 +1,15 @@\n import { authenticate } from "./lib";\n\n-export function login(user: string) {\n+export function login(user: string, password: string) {\n   return authenticate(user, password);\n }',
      },
      {
        path: 'src/user.ts',
        status: 'added',
        additions: 10,
        deletions: 0,
        patch: '@@ -0,0 +1,10 @@\n+export interface User {\n+  id: string;\n+  name: string;\n+  email: string;\n+}',
      },
      {
        path: 'docs/api.md',
        status: 'modified',
        additions: 0,
        deletions: 3,
        patch: '@@ -10,3 +10,0 @@\n-## Deprecated\n-This section is removed.\n',
      },
    ],
  };
}
