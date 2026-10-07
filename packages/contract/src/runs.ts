import { z } from 'zod';
import { runnerSchema } from './health.ts';
import { referenceStatusSchema } from './github.ts';
// The chain shapes belong to the workflows family; the run record embeds one, so this file
// consumes them rather than redeclaring. One-way on purpose — see the header of `./workflows.ts`.
import { workflowDefSchema, workflowStepDefSchema } from './workflows.ts';
// Same one-way direction: the dispatch family owns the `dispatch` object's shape, the run record embeds
// one. `src/runs/store.ts` imports the SAME value for its persistence twin, so the two halves of
// `contract-parity.runs.test.ts` cannot drift apart by construction.
import { dispatchIntentSchema, dispatchSchema } from './dispatch.ts';

/**
 * The RUNS family of `/api/v1` — a task's record, its lifecycle mutations, and the artifacts
 * (queued prompt stack, commits, git actions) that hang off one run.
 *
 * The record itself is persisted by `src/runs/store.ts`, so these schemas describe a shape that
 * already has a zod definition server-side; they are the WIRE half of it, and the parity guard in
 * `src/server/contract-parity.runs.test.ts` is what keeps the two from drifting.
 *
 * Two things about the mutation responses are deliberate and were measured, not assumed:
 *
 *  - every "did it work" flag is a `z.literal(true)`, not a boolean. Each of those routes answers
 *    409 (or 404) on refusal, so `false` is not a value the 200 branch can carry — the
 *    hand-written DTO's `boolean` invited a re-check the server never needs. `cancelled` is the
 *    one real boolean: `POST /runs/:id/cancel` answers 200 either way.
 *  - `POST /runs/:id/messages` answers a three-way UNION, not one object with three optional
 *    keys. The client narrows on which key is present, and the DTO's flattened shape allowed
 *    `{}` — a payload the route cannot produce.
 */

// ---- the record --------------------------------------------------------------------------

/** One authoritative PR association; optional for compatibility with older run records. */
export const runPrRefSchema = z.object({
  number: z.number().int().positive(),
  url: z.string().url().optional(),
  origin: z.enum(['created', 'marker', 'legacy', 'derived']),
  at: z.string(),
});
export type RunPrRef = z.infer<typeof runPrRefSchema>;

export const runStatusSchema = z.enum([
  'queued',
  'running',
  'waiting',
  'review',
  'done',
  'failed',
  'cancelled',
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

/**
 * Sub-state of `running` (spec 2026-07-18-subagent-monitoring-status, #490): the agent ended its
 * turn still working on its own downstream work (a sub-agent, a monitored command) and said so
 * with the `CEZ:MONITORING` marker — a non-attention state, not "needs you".
 */
export const runActivitySchema = z.enum(['monitoring']);
export type RunActivity = z.infer<typeof runActivitySchema>;

export const stepStatusSchema = z.enum([
  'pending',
  'running',
  'waiting',
  'review',
  'done',
  'failed',
  'cancelled',
  'skipped',
]);
export type StepStatus = z.infer<typeof stepStatusSchema>;

const usageCounterSchema = z.number().finite().nonnegative();

/** One step of a run's chain. */
export const stepStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['agent', 'check']),
  status: stepStatusSchema,
  iterations: z.number(),
  tokensUsed: z.number(),
  inputTokens: usageCounterSchema.optional(),
  outputTokens: usageCounterSchema.optional(),
  usageInvocationsStarted: usageCounterSchema.optional(),
  usageInvocationsObserved: usageCounterSchema.optional(),
  usageTurnsStarted: usageCounterSchema.optional(),
  usageTurnsRecorded: usageCounterSchema.optional(),
  usageInvocationEpoch: usageCounterSchema.optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  error: z.string().optional(),
  /** Latest agent session id — `claude --resume <id>` and friends. */
  sessionId: z.string().optional(),
  /** Backend that owns `sessionId`; absent on records written before backend affinity. */
  backend: runnerSchema.optional(),
  /** Agent account (spec 2026-07-29-agent-profiles) that owns `sessionId` — `default`, or a
   *  stored profile id. The two are a PAIR: a session id only resolves inside the config dir
   *  that created it, so resume and Continue read this rather than the project's current
   *  selection. Absent on records written before accounts existed. */
  profileId: z.string().optional(),
  costUsd: z.number().optional(),
});
export type StepState = z.infer<typeof stepStateSchema>;

/** Aggregate diff numbers of a run's worktree vs its base (#389). */
export const diffStatSchema = z.object({
  adds: z.number(),
  dels: z.number(),
  files: z.number(),
  /** Additive since #751, and present ONLY when true: the numbers were measured against a
   *  branch the agent checked out into the task's worktree, as the run found it, because the
   *  worktree's HEAD had been repointed off the task's own branch (every review/QA run does
   *  this) and the merge-base anchor would otherwise have reported that branch's entire diff
   *  as this task's. Absent on every normal run and on every record written before #751 — a
   *  consumer that ignores it sees exactly the old shape. */
  repointed: z.boolean().optional(),
});
export type DiffStat = z.infer<typeof diffStatSchema>;

/** One prompt message stacked onto a run while it waits for a free agent slot (#472). */
export const queuedMessageSchema = z.object({
  id: z.string(),
  text: z.string(),
  /** `/api/v1/runs/:id/images/…` URLs — attachments are persisted, never inlined. Images and
   *  files share this one list; read `isImageAttachmentName` on the file name to tell them apart. */
  images: z.array(z.string()).optional(),
  createdAt: z.string(),
});
export type QueuedMessage = z.infer<typeof queuedMessageSchema>;

/** One aggregated sample of a run's live process tree (`src/core/process-usage.ts`). */
export const processUsageSchema = z.object({
  /** Sum of `%cpu` across the tree — can exceed 100 on multi-core work. */
  cpuPct: z.number(),
  rssBytes: z.number(),
  procCount: z.number(),
});
export type ProcessUsage = z.infer<typeof processUsageSchema>;

/**
 * The stored run record, as `runs.json` holds it (`src/runs/store.ts`).
 *
 * `archived` is required although the store schema defaults it: a default fills on PARSE, so the
 * key is always present in what the server hands out. Everything else optional here is optional
 * there — these are additive fields, and an absent one means "this run predates it".
 */
export const runRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Display title (#389): auto-derived from the first agent turn, or the user's inline edit
   *  (`PATCH /runs/:id` sets it together with `title`). Show `titleSummary ?? title`. */
  titleSummary: z.string().optional(),
  /** Refreshed on every turn-end; absent until the first turn ends (and on worktree-less runs). */
  diffStat: diffStatSchema.optional(),
  workflow: z.string(),
  task: z.string(),
  /** Prompt messages stacked onto the run while it waited for a free agent slot (#472). Folded
   *  into the prompt at dequeue — never delivered as their own turns. Absent on pre-#472 runs. */
  queuedMessages: z.array(queuedMessageSchema).optional(),
  /** URLs of the attachments on the initial task prompt (#image-display) — images and, since
   *  #950, files. One list, one numbering space; branch on `isImageAttachmentName`. */
  taskImages: z.array(z.string()).optional(),
  model: z.string().optional(),
  /** Normalized provider/model identity used for attribution and reproducible replay. */
  modelIdentity: z.string().optional(),
  runner: runnerSchema.optional(),
  /** The composer's per-task agent account (spec 2026-07-29-agent-profiles), applying to steps
   *  on `runner`. Absent = the run follows the project's own selection. */
  agentProfile: z.string().optional(),
  /** Echo of the extra system prompt the run used (POST override or config default). */
  systemPrompt: z.string().optional(),
  /** false when the run deliberately disabled follow-up todo generation. Absent means enabled. */
  generateFollowups: z.boolean().optional(),
  /** Autonomous mode (#autonomous): the run never parks at `waiting` or the terminal `review`
   *  gate. Absent = falsy = not autonomous. */
  autonomous: z.boolean().optional(),
  /**
   * Provenance for a task a project GitHub automation launched (#694). Absent on every ordinary
   * run, which is what makes it additive — the cockpit shows the "from automation" link only when
   * it is there.
   *
   * `event` is a plain string rather than `automationEventSchema`: it is the event NAME the
   * launching definition matched, recorded on the run for the audit trail, and `src/runs/store.ts`
   * persists it as free text so an older cezar can still read a record written by a newer one.
   */
  automation: z
    .object({
      automationId: z.string(),
      automationRevision: z.number(),
      receiptId: z.string(),
      event: z.string(),
      githubUrl: z.string(),
    })
    .optional(),
  /**
   * Provenance for a task a SCHEDULED automation launched (spec 2026-09-14-automations-redesign
   * § Data Model). A separate optional key rather than a loosened `automation`: `runs.json` is
   * parsed as one array, so a downgraded cezar meeting a record without `githubUrl` would drop
   * every run — whereas an unknown key it simply strips.
   */
  automationTrigger: z
    .object({
      automationId: z.string(),
      automationRevision: z.number(),
      receiptId: z.string(),
      trigger: z.enum(['schedule', 'catch-up', 'manual']),
      /** The scheduled wall-time instant (UTC ISO); for `manual`, the launch time. */
      occurrenceAt: z.string(),
    })
    .optional(),
  /**
   * This run's place in a dispatch tree (spec `.ai/specs/2026-09-10-dispatch.md`): its root,
   * its parent, its budget, its report. Absent on a plain task, which behaves exactly as it
   * always has.
   */
  dispatch: dispatchSchema.optional(),
  status: runStatusSchema,
  /** `monitoring` while `status === 'running'` and the agent is working on downstream work.
   *  Absent on old runs; cleared on resume/end. */
  activity: runActivitySchema.optional(),
  /** Exact ISO-8601 deadline for the next automatic monitoring check. */
  monitoringWakeAt: z.string().optional(),
  /** The current live monitoring epoch exhausted its 40 automatic checks. */
  monitoringWakeCapReached: z.boolean().optional(),
  /** Exact ISO-8601 instant this run resumes itself after a provider usage limit stopped it
   *  (spec 2026-08-03-auto-resume-after-usage-limit). Present only on a `failed` run with a
   *  pending automatic resume — its absence is what "no resume is scheduled" looks like. */
  autoResumeAt: z.string().optional(),
  /** Consecutive automatic resumes since the last human turn, against the safety cap. */
  autoResumeAttempts: z.number().optional(),
  /** ISO-8601 instant the run's session ended (inactivity, a crash, a restart) while a `CEZ:ASK`
   *  question was still unanswered. Present only on a `failed` run; the cockpit keeps such a run
   *  under "needs you" until the answer reopens it. Absent on records written before it existed. */
  awaitingAnswerSince: z.string().optional(),
  createdAt: z.string(),
  /** Custom queue position timestamp — when set, overrides createdAt for queue ordering.
   *  Allows manual reordering of queued tasks. Absent on runs that use their natural creation order. */
  queuePosition: z.string().optional(),
  /** When true, this run is paused in the queue and will not start automatically.
   *  User must manually start it via `POST /runs/:id/start-queued`. Absent = not paused. */
  paused: z.boolean().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  tokensUsed: z.number(),
  inputTokens: usageCounterSchema.optional(),
  outputTokens: usageCounterSchema.optional(),
  costUsd: z.number().optional(),
  pullRequestUrl: z.string().optional(),
  /** The PR this task is ABOUT (#407) — auto-discovered from conversation references. Display
   *  tier only: `pullRequestUrl` (the PR this task CREATED) wins, and the action gates ignore it. */
  referencedPullRequestUrl: z.string().optional(),
  /** The PR/issue number this task is ABOUT (task auto-naming spec) — display tier only. */
  prNumber: z.number().optional(),
  prRefs: z.array(runPrRefSchema).max(8).optional(),
  issueNumber: z.number().optional(),
  /** Server-side provenance: referenced-issue discovery currently owns `issueNumber`. */
  referencedIssueNumberSeeded: z.boolean().optional(),
  /** 'user' = renamed via PATCH, never auto-overwritten; 'marker' = agent-declared via
   *  CEZ:TITLE (spec 2026-07-18-task-ref-markers); 'auto' = namer-owned. */
  titleOrigin: z.enum(['user', 'auto', 'marker']).optional(),
  /** References the agent declared via CEZ:PR/CEZ:ISSUE markers — authoritative over the namer
   *  for the matching kind. */
  markerRefs: z.object({ pr: z.number().optional(), issue: z.number().optional() }).optional(),
  /** The referenced tier's working set (distinct PR URLs spotted, capped server-side). */
  referencedPrCandidates: z.array(z.string()).optional(),
  /** The issue this task is ABOUT (spec 2026-07-21-report-ref-discovery). Display-only. */
  referencedIssueUrl: z.string().optional(),
  /** The referenced-issue working set, persisted like `referencedPrCandidates`. Capped. */
  referencedIssueCandidates: z.array(z.string()).optional(),
  /** Explicit execution policy. `false` means the run intentionally uses the repo root;
   *  absent on older runs and for the default isolated-worktree mode. */
  worktree: z.literal(false).optional(),
  /** Absent for in-place runs and after an isolated worktree is removed. */
  worktreePath: z.string().optional(),
  branch: z.string().optional(),
  /** Stable baseline for session git views: a worktree's fork ref, or an in-place run's starting commit. */
  baseBranch: z.string().optional(),
  /** Set when count-based retention (#483) reclaimed the worktree DIRECTORY (the branch is
   *  kept): the dir is gone but recoverable. */
  worktreeReclaimedAt: z.string().optional(),
  /** Parallel variants (spec 010): runs sharing a groupId are one group. */
  groupId: z.string().optional(),
  /** Variant letter within the group — 'A' | 'B' | 'C'. */
  variant: z.string().optional(),
  peakRssBytes: z.number().optional(),
  peakProcCount: z.number().optional(),
  archived: z.boolean(),
  archivedAt: z.string().optional(),
  /** Pinned to the top of this project's task list (#935) — the `Pinned` group above
   *  `Needs you`. Optional, unlike `archived`: absent IS "not pinned", which is what every
   *  record written before this carries, and the store never writes `false`. Archiving
   *  clears it, because archiving is how a user resigns from a task. */
  pinned: z.boolean().optional(),
  /** When the pin was set. Deliberately WRITE-ONLY today, like the `archivedAt` above it:
   *  ordering inside `Pinned` uses the ordinary status/recency rules, so nothing reads this
   *  yet. It is here because a field on a protected surface is far cheaper to add now than to
   *  add later — "pinned oldest first" and "unpin what you pinned a month ago" both need it,
   *  and neither can be reconstructed after the fact. */
  pinnedAt: z.string().optional(),
  /** Read receipt (#unread-done-items): ISO time the cockpit last opened this run's
   *  thread. A finished (`done`/`failed`) run reads as *unread* until seen since it
   *  finished — see `isUnread()` in the cockpit's `lib/read-state.ts`. Absent on old
   *  runs, on any run not yet opened, and on one deliberately put back to unread via
   *  `POST /runs/:id/unread` (#775) — all three count as unread. */
  seenAt: z.string().optional(),
  currentStepId: z.string().optional(),
  error: z.string().optional(),
  steps: z.array(stepStateSchema),
  /**
   * The persisted workflow definition, so a `queued` run survives a restart — including the ad-hoc
   * "(planned)" chains that exist nowhere else.
   *
   * Typed and required: the contract describes what `GET /runs` actually sends (every run since #367
   * carries one), and `runRecordSchema` is also the ONE place `workflowDefSchema` is admitted
   * at the source: `src/runs/store.ts` persists a typed `workflowDefSchema` now, so the route's own
   * type is this shape and the two-way check in `src/server/contract-parity.runs.test.ts` covers it
   * the same way every other embedded type here is covered.
   */
  workflowDef: workflowDefSchema,
});
export type RunRecord = z.infer<typeof runRecordSchema>;

/**
 * What `GET /runs` and `GET /runs/:id` answer: the stored record plus the live `usage` sample the
 * server attaches on the way out (`withUsage`). Absent for finished runs and wherever `ps` yields
 * nothing — the field is optional, not a default. Using a union for the non-usage half keeps the
 * route signature from widening `usage: ProcessUsage | undefined` into `unknown`.
 */
export const apiRunSchema = z.union([
  runRecordSchema,
  runRecordSchema.extend({ usage: processUsageSchema }),
]);
export type ApiRun = z.infer<typeof apiRunSchema>;

/**
 * One run in the WORKSPACE-level index (`GET /api/v1/workspace/runs-index`) — the ⌘K palette's
 * source. A subset of `RunRecord` (not a projection — the same zod keys), plus the unique
 * `projectId` so the cross-project list can route you to the right project. Subset rationale:
 * loading all fields of ~200 runs per project × N registered projects defeats caching, slows the
 * paint, and inflates network cost when the palette itself uses only title + status + dates + a
 * couple optional fields. Add more fields here as the palette needs them; removing one is a
 * breaking change (the contract promises it is there).
 */
export const runIndexEntrySchema = runRecordSchema
  .pick({
    id: true,
    title: true,
    titleSummary: true,
    workflow: true,
    status: true,
    archived: true,
    pinned: true,
    createdAt: true,
    startedAt: true,
    finishedAt: true,
    tokensUsed: true,
    costUsd: true,
    prNumber: true,
    issueNumber: true,
    groupId: true,
    variant: true,
    seenAt: true,
    queuePosition: true,
  })
  .extend({
    projectId: z.string(),
    /** Absent when unknown (no `gh`, no remote, a non-git project). */
    repoHandle: z.object({ owner: z.string(), name: z.string() }).optional(),
    /**
     * `GET /runs` attaches it (`withUsage`) — never persisted.
     *
     * Optional for two reasons: live usage isn't on a finished run, and (while we could simply
     * omit those) the usage collector is a singleton across every project: every cezar process
     * runs every project's agents, so `currentUsage(runId)` knows about a run whatever project it
     * is in, which is what lets the index aggregate without rereading process tables. Including
     * it here costs no extra work.
     */
    usage: processUsageSchema.optional(),
  });
export type RunIndexEntry = z.infer<typeof runIndexEntrySchema>;

/**
 * The ⌘K run palette (`GET /api/v1/workspace/runs-index`): newest 50 from each registered
 * project, deduplicated by project id (a repo registered at two paths renders one entry only,
 * under whichever came first). Capped so the endpoint stays fast — a palette user types a few
 * chars, they don't scroll 2000 rows.
 *
 * `GET /workspace/runs-index`.
 */
export const runsIndexResponseSchema = z.object({
  /** Newest first, across every registered project. Archived runs are included — `GET /runs`
   *  is where the archive tab lives, and the index must route you to it. */
  runs: z.array(runIndexEntrySchema),
  /** How many runs were included per project (informational, for dev diagnostics). */
  counts: z.record(z.string(), z.number()),
  /** Ids of the projects that had more runs than the cap allowed. */
  truncated: z.array(z.string()),
});
export type RunsIndexResponse = z.infer<typeof runsIndexResponseSchema>;

// ---- mutations --------------------------------------------------------------------------

/**
 * `POST /runs` (201) — one record for ×1, a group for ×2/×3.
 *
 * `usage` is omitted: the task is `queued`, meaning it has no live agent process tree and no usage
 * exists, so the create route never runs a record through `withUsage`.
 */
export const createRunResponseSchema = z.union([
  runRecordSchema,
  z.object({ runs: z.array(runRecordSchema) }),
]);
export type CreateRunResponse = z.infer<typeof createRunResponseSchema>;

/** `POST /runs/:id/cancel` — genuinely a boolean: an already-settled run answers 200 + `false`. */
export const cancelResponseSchema = z.object({ cancelled: z.boolean() });
export type CancelResponse = z.infer<typeof cancelResponseSchema>;

/**
 * `DELETE /runs/:id/auto-resume` (spec 2026-08-03-auto-resume-after-usage-limit) — the per-task
 * cancellation gate in the session header. A run without a pending resume answers 409.
 */
export const deleteAutoResumeResponseSchema = z.object({ deleted: z.literal(true) });
export type DeleteAutoResumeResponse = z.infer<typeof deleteAutoResumeResponseSchema>;

/** `POST /runs/archive-finished` — how many runs the sweep archived. */
export const archiveFinishedResponseSchema = z.object({ archived: z.number() });
export type ArchiveFinishedResponse = z.infer<typeof archiveFinishedResponseSchema>;

/** `POST /runs/read-all` — how many unread finished runs the sweep marked read. */
export const markAllReadResponseSchema = z.object({ read: z.number() });
export type MarkAllReadResponse = z.infer<typeof markAllReadResponseSchema>;

/** `DELETE /runs/:id` — an active run is a 409 and an unknown one a 404, so this only ever
 *  reports success. */
export const deleteRunResponseSchema = z.object({ deleted: z.literal(true) });
export type DeleteRunResponse = z.infer<typeof deleteRunResponseSchema>;

/** `POST /runs/:id/finish` — "no open session" is a 409. */
export const finishResponseSchema = z.object({ finished: z.literal(true) });
export type FinishResponse = z.infer<typeof finishResponseSchema>;

/** `POST /runs/:id/continue` — a refusal to reopen is a 409 carrying the engine's reason. */
export const continueResponseSchema = z.object({ continued: z.literal(true) });
export type ContinueResponse = z.infer<typeof continueResponseSchema>;

/** `POST /runs/:id/start-queued` — manually start a paused/queued task. */
export const startQueuedResponseSchema = z.object({ started: z.literal(true) });
export type StartQueuedResponse = z.infer<typeof startQueuedResponseSchema>;

/**
 * `POST /runs/:id/pr` (201, spec 009) — the draft PR's URL; `dryRun` marks the CEZ_DRY_RUN fake
 * (no push, no gh). Failure is a 409 whose `ApiError` carries the `manual` merge command instead.
 *
 * `dryRun` is REQUIRED: `createDraftPr`'s success outcome always sets it (`forge/types.ts`), so
 * the key is always on the wire. The hand-written DTO had it optional.
 */
export const createPrResponseSchema = z.object({
  url: z.string(),
  dryRun: z.boolean(),
});
export type CreatePrResponse = z.infer<typeof createPrResponseSchema>;

/**
 * `POST /runs/:id/messages` — one of three shapes (#472), by how far the run has got:
 * `delivered` (a live session took it), `queued` (still waiting for a slot, so it was stacked
 * onto the prompt and the stored entry rides along), `deferred` (mid-spawn, so it was buffered
 * and arrives as an ordinary follow-up turn once the session opens). Anything else is a 409.
 *
 * A union, not one object of optional flags: exactly one of the three keys is ever present, and
 * the flattened DTO shape admitted `{}`. Pre-#472 clients only ever saw `delivered`.
 */
export const messageResponseSchema = z.union([
  z.object({ delivered: z.literal(true) }),
  z.object({ queued: z.literal(true), message: queuedMessageSchema }),
  z.object({ deferred: z.literal(true) }),
]);
export type MessageResponse = z.infer<typeof messageResponseSchema>;

/** `PATCH /runs/:id/queued-messages/:msgId` (#472) — the replaced entry. */
export const editQueuedMessageResponseSchema = z.object({ message: queuedMessageSchema });
export type EditQueuedMessageResponse = z.infer<typeof editQueuedMessageResponseSchema>;

/** `DELETE /runs/:id/queued-messages/:msgId` (#472) — `409 run already started` otherwise. */
export const deleteQueuedMessageResponseSchema = z.object({ deleted: z.literal(true) });
export type DeleteQueuedMessageResponse = z.infer<typeof deleteQueuedMessageResponseSchema>;

/**
 * `POST /runs/:id/open-in-cli` — a terminal was spawned with `command` running in it. With no
 * installed terminal or in remote mode, a 409 carries the command line you'd paste instead.
 */
export const openInCliResponseSchema = z.object({ opened: z.literal(true), command: z.string() });
export type OpenInCliResponse = z.infer<typeof openInCliResponseSchema>;

/** `POST /runs/:id/unread` (#775) — marks a finished run back to unread. A 409 otherwise. */
export const setUnreadResponseSchema = z.object({ unread: z.literal(true) });
export type SetUnreadResponse = z.infer<typeof setUnreadResponseSchema>;

/** `POST /runs/:id/remove-worktree` — per-row delete in the worktrees panel (#483). */
export const removeWorktreeResponseSchema = z.object({ removed: z.literal(true) });
export type RemoveWorktreeResponse = z.infer<typeof removeWorktreeResponseSchema>;

/** `POST /runs/:id/git/commit` — `git add -A && git commit` in the run's worktree. */
export const commitInputSchema = z.object({
  message: z.string().trim().min(1).max(10_000),
});
export type CommitInput = z.input<typeof commitInputSchema>;

export const commitResponseSchema = z.object({
  committed: z.literal(true),
  sha: z.string(),
});
export type CommitResponse = z.infer<typeof commitResponseSchema>;

/** `POST /runs/:id/git/push` — push the worktree's branch, setting upstream if it has none. */
export const pushResponseSchema = z.object({ pushed: z.literal(true) });
export type PushResponse = z.infer<typeof pushResponseSchema>;

/** `GET /runs/:id/commits` — `<base>..HEAD` on the worktree branch, newest first. */
export const commitSchema = z.object({
  sha: z.string(),
  message: z.string(),
  author: z.string(),
  date: z.string(),
});
export type Commit = z.infer<typeof commitSchema>;

export const commitsResponseSchema = z.object({
  commits: z.array(commitSchema),
});
export type CommitsResponse = z.infer<typeof commitsResponseSchema>;

// `/groups/:groupId/*` is the RUN family seen sideways: a group is the runs sharing a `groupId`,
// not a separate entity.

/** One variant tile of the compare strip (#380). */
export const groupVariantSchema = z.object({
  id: z.string(),
  variant: z.string(),
  title: z.string(),
  status: runStatusSchema,
  /** Present only on a `review`/`done`/`failed` run. */
  finishedAt: z.string().optional(),
  tokensUsed: z.number(),
  costUsd: z.number().optional(),
  /**
   * CAREFUL: `diffStat` here is the raw `git diff --stat` TEXT the server runs in the variant's
   * worktree, NOT the stored `diffStat` object. The panel reads it, the consumer does not parse
   * it — see the route handler comment.
   */
  diffStat: z.string().optional(),
});
export type GroupVariant = z.infer<typeof groupVariantSchema>;

/** `GET /groups/:groupId` — the compare strip's source. */
export const groupResponseSchema = z.object({
  groupId: z.string(),
  title: z.string(),
  runs: z.array(groupVariantSchema),
});
export type GroupResponse = z.infer<typeof groupResponseSchema>;

// ---- inputs ------------------------------------------------------------------------------

/** An image or file attachment (the two share one schema, distinguished by name pattern). */
export const attachmentInputSchema = z.object({
  /** For files: original extension + pre-persisted server-provided filename; for images:
   *  generated by `generateUniqueImageName`. */
  name: z.string(),
  /** base64 data URI or raw base64 — the route accepts both. */
  data: z.string(),
});
export type AttachmentInput = z.input<typeof attachmentInputSchema>;

/** One step of an inline chain (spec 008): the step definition keys we actually honor. */
const createRunStepInputSchema = z.object({
  name: z.string(),
  /** Exactly one of `prompt`/`skill`/`command` — the XOR is the refinement below. */
  prompt: z.string().optional(),
  skill: z.string().optional(),
  command: z.string().optional(),
  /** The runner and profile this step spawns under. Absent = follow `CreateRunInput.runner`
   *  and the run's own `agentProfile` for agent steps. */
  runner: runnerSchema.optional(),
  agentProfile: z.string().optional(),
});

/**
 * The KEYS of `POST /runs`' body, before the XOR refinement that `createRunInputSchema` adds.
 *
 * Exported separately so downstream code can test a *widened* object (title + workflow + prompt)
 * and then narrow the result to what the route actually admits (title + (workflow XOR steps) +
 * prompt) — see `task-create.test.tsx`, which validates a handwritten object rather than a
 * runtime-constructed payload. Without this export, it would have to suppress the type error or
 * guess the discriminant.
 */
export const createRunInputKeys = z.object({
  title: z.string().trim().min(1).max(300),
  workflow: z.string().optional(),
  /** An inline chain (spec 008 — an approved plan runs as an ad-hoc workflow, never written to
   *  the catalog). Optional, and mutually exclusive with `workflow`: exactly one of the two. */
  steps: z.array(createRunStepInputSchema).optional(),
  task: z.string().trim().min(1).max(100_000),
  images: z.array(attachmentInputSchema).max(4).default([]),
  model: z.string().optional(),
  runner: runnerSchema.optional(),
  /** Composer's per-task agent account (spec 2026-07-29-agent-profiles), applying to steps on
   *  `runner`. Absent = the run follows the project's own selection. */
  agentProfile: z.string().optional(),
  generateFollowups: z.boolean().optional(),
  autonomous: z.boolean().optional(),
  /** 1–3. Above 1 the response is `{ runs }` rather than a single record. */
  variantCount: z.literal(1).or(z.literal(2)).or(z.literal(3)).default(1),
  worktree: z.literal(false).optional(),
  /**
   * Provenance from the dispatch entry point (`/runs/:id/dispatch`, spec 2026-09-10-dispatch).
   * Additive and optional so this schema stays the route's request shape too; the dispatch route
   * always provides it, `POST /runs` never does.
   */
  dispatch: dispatchIntentSchema.optional(),
  /**
   * When true, the task is created in a paused state and added to the queue without starting.
   * The user must manually start it later via `POST /runs/:id/start-queued`.
   */
  queueOnly: z.boolean().optional(),
});
export type CreateRunInputKeys = z.input<typeof createRunInputKeys>;

/**
 * `POST /runs`. Exactly one of `workflow` / `steps` — the server rejects both or neither.
 *
 * Also the KEY of `/api/v1/runs/:id/dispatch` (same body plus the `dispatch` intent, already in
 * `createRunInputKeys`). Two routes, one body validator.
 */
export const createRunInputSchema = createRunInputKeys.refine(
  (data) => (data.workflow !== undefined) !== (data.steps !== undefined),
  { message: 'exactly one of workflow or steps required' },
);
export type CreateRunInput = z.input<typeof createRunInputSchema>;

/**
 * `POST /runs/:id/messages` — text and/or pasted attachments for a live session. Both keys have
 * a default, so you can post `{}` to nudge an idle autonomous run, which is why the refinement
 * is what rejects a message that is empty in both.
 */
export const messageInputSchema = z
  .object({
    text: z.string().max(100_000).default(''),
    images: z.array(attachmentInputSchema).max(4).default([]),
  })
  .refine((m) => m.text.trim().length > 0 || m.images.length > 0, {
    message: 'message needs text or at least one attachment',
  });
export type MessageInput = z.input<typeof messageInputSchema>;

/**
 * `PATCH /runs/:id` (#389). `title` is trimmed server-side, 1–300 chars, and the edit sets both
 * `title` and `titleSummary` so it wins over any auto-summary. `task` (#472) is the initial
 * prompt, editable only while the run is still queued — any other status answers
 * `409 run already started`, and the folded total across the task and its stack bounds it again.
 */
export const patchRunInputSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  task: z.string().trim().min(1).max(100_000).optional(),
});
export type PatchRunInput = z.input<typeof patchRunInputSchema>;

/**
 * `POST /runs/reorder-queue` — reorder queued tasks by explicitly setting their queue positions.
 * Only `queued` runs can be reordered; attempting to reorder a non-queued run returns 409.
 */
export const reorderQueueInputSchema = z.object({
  /** Array of run IDs in the desired queue order (first = #1 in queue). */
  runIds: z.array(z.string()).min(1),
});
export type ReorderQueueInput = z.input<typeof reorderQueueInputSchema>;

/** `POST /runs/reorder-queue` response — confirms the reordering. */
export const reorderQueueResponseSchema = z.object({
  reordered: z.literal(true),
  /** Number of runs that were actually reordered. */
  count: z.number(),
});
export type ReorderQueueResponse = z.infer<typeof reorderQueueResponseSchema>;

/** `PATCH /runs/:id/queued-messages/:msgId` — replace the text of one queued message. */
export const editQueuedMessageInputSchema = z.object({
  text: z.string().trim().min(1).max(100_000),
});
export type EditQueuedMessageInput = z.input<typeof editQueuedMessageInputSchema>;
