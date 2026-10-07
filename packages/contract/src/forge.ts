import { z } from 'zod';

/**
 * Multi-forge contract schemas for merge operations, diffs, and CI checks.
 * Provides forge-agnostic types for GitLab, Gitea, Forgejo operations.
 * 
 * Spec: .ai/specs/2026-10-07-high-priority-improvements.md
 */

/** Supported merge methods across all forges. */
export const forgeMergeMethodSchema = z.enum(['merge', 'squash', 'rebase']);
export type ForgeMergeMethod = z.infer<typeof forgeMergeMethodSchema>;

/** One CI/CD check or job result. */
export const forgePrCheckSchema = z.object({
  name: z.string(),
  state: z.enum(['passing', 'failing', 'pending', 'unknown']),
  /** Whether this check is required for merge. Null when unknown. */
  required: z.boolean().nullable(),
  /** Web URL to the check details page. */
  url: z.string().optional(),
});
export type ForgePrCheck = z.infer<typeof forgePrCheckSchema>;

/** Complete merge state for a pull/merge request. */
export const forgePrMergeStateSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.enum(['open', 'closed', 'merged']),
  isDraft: z.boolean(),
  headRef: z.string(),
  baseRef: z.string(),
  headSha: z.string(),
  /** Can this PR/MR be merged without conflicts? */
  mergeable: z.enum(['mergeable', 'conflicting', 'unknown']),
  /** Review/approval status. */
  reviewDecision: z.enum(['approved', 'changes-requested', 'review-required', 'unknown']),
  /** CI/CD checks for this PR/MR. */
  checks: z.array(forgePrCheckSchema),
  /**
   * How much check detail the forge provided:
   * - detailed: One row per check with names and links
   * - aggregate: Only rolled-up state available
   * - none: No check information readable
   */
  checksTier: z.enum(['detailed', 'aggregate', 'none']),
  /** Why checks tier degraded (when not 'detailed'). */
  checksReason: z.string().optional(),
  /** Available merge methods for this PR/MR. */
  methods: z.array(forgeMergeMethodSchema),
  /** Default/recommended merge method. */
  defaultMethod: forgeMergeMethodSchema.nullable(),
  /**
   * Merge eligibility:
   * - ready: Can merge now
   * - blocked: Cannot merge (conflicts, failing checks, etc.)
   * - pending: Waiting (checks running, reviews pending)
   * - unauthorized: Lacks permissions
   * - terminal: Closed or merged already
   * - unknown: Cannot determine state
   */
  eligibility: z.enum(['ready', 'blocked', 'pending', 'unauthorized', 'terminal', 'unknown']),
  /** What is blocking this merge. */
  blockers: z.array(z.object({
    code: z.string(),
    message: z.string(),
  })),
  /** Can the user merge this PR/MR right now? */
  canMerge: z.boolean(),
  /** Can override rules (admin/maintainer only)? */
  canOverride: z.boolean(),
});
export type ForgePrMergeState = z.infer<typeof forgePrMergeStateSchema>;

/** Response for GET /api/v1/forge/pr/:number/merge-state */
export const forgePrMergeStateResponseSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(true),
    mergeState: forgePrMergeStateSchema,
  }),
  z.object({
    available: z.literal(false),
    reason: z.string(),
  }),
]);
export type ForgePrMergeStateResponse = z.infer<typeof forgePrMergeStateResponseSchema>;

/** Input for POST /api/v1/forge/pr/:number/merge */
export const forgeMergeInputSchema = z.object({
  method: forgeMergeMethodSchema,
  /** Expected HEAD SHA to prevent race conditions. */
  expectedHeadSha: z.string(),
  /** Override merge rules (requires admin/maintainer). */
  overrideRules: z.boolean().optional(),
});
export type ForgeMergeInput = z.infer<typeof forgeMergeInputSchema>;

/** Response for POST /api/v1/forge/pr/:number/merge (200 branch only) */
export const forgeMergeResponseSchema = z.object({
  merged: z.literal(true),
  number: z.number(),
  url: z.string(),
  method: forgeMergeMethodSchema,
  mergeCommitSha: z.string().optional(),
});
export type ForgeMergeResponse = z.infer<typeof forgeMergeResponseSchema>;

/** One changed file in a PR/MR diff. */
export const forgePrChangeSchema = z.object({
  path: z.string(),
  previousPath: z.string().optional(),
  status: z.enum(['added', 'modified', 'removed', 'renamed', 'copied', 'changed']),
  additions: z.number(),
  deletions: z.number(),
  /** Unified diff patch text. */
  patch: z.string().optional(),
  /** Why patch is unavailable. */
  patchUnavailableReason: z.enum(['binary', 'too-large', 'not-provided']).optional(),
  /** True if patch was truncated due to size. */
  truncated: z.boolean().optional(),
});
export type ForgePrChange = z.infer<typeof forgePrChangeSchema>;

/** Response for GET /api/v1/forge/pr/:number/diff */
export const forgePrDiffResponseSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(true),
    number: z.number(),
    headSha: z.string(),
    files: z.array(forgePrChangeSchema),
    additions: z.number(),
    deletions: z.number(),
    /** True if file list was capped. */
    truncated: z.boolean(),
    /** Additional context when truncated or partially available. */
    reason: z.string().optional(),
  }),
  z.object({
    available: z.literal(false),
    reason: z.string(),
  }),
]);
export type ForgePrDiffResponse = z.infer<typeof forgePrDiffResponseSchema>;
