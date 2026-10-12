import type { RunRecord, RunStatus } from '@open-mercato/cezar-api-client'
import type { TranslationKey } from '@/i18n/translations'

/**
 * Bulk deletion — the pure half of the Tasks table's sweep controls.
 *
 * Two gestures, one rule each, both stated here rather than in the markup that paints them: what a
 * run must be before it can be deleted at all, and which status a "clear by status" click would
 * promise. Pure on purpose — the rule that decides whether a row may vanish is the one worth
 * pinning in a table test, and the table below it (the Tasks overview) only paints.
 */

/**
 * The statuses a run can be deleted in. Since the server's delete STOPS what the engine still
 * owns first (cancel + bounded wait for release, then remove), every status is deletable —
 * `running`/`queued`/`waiting` included. The list stays explicit (not `Object.values`) so a
 * future status must be consciously added here rather than silently swept, and so the menu
 * order below stays deliberate.
 */
const DELETABLE_STATUSES = [
  'queued',
  'running',
  'waiting',
  'done',
  'failed',
  'cancelled',
  'review',
] as const satisfies readonly RunStatus[]

const DELETABLE: ReadonlySet<RunStatus> = new Set(DELETABLE_STATUSES)

/** Menu order: the outcomes first, then the gate. Also the exhaustive set — a status outside it
 *  has no entry, so a new one cannot quietly become unsweepable without this list noticing. */
export const DELETABLE_STATUS_ORDER: readonly RunStatus[] = DELETABLE_STATUSES

export function isDeletableRun(run: RunRecord): boolean {
  return DELETABLE.has(run.status)
}

/** The rows of `runs` a sweep may take, in the order given. */
export function deletableRuns(runs: readonly RunRecord[]): RunRecord[] {
  return runs.filter(isDeletableRun)
}

export interface StatusClearOption {
  status: RunStatus
  /** How many rows of the list this option would remove. */
  count: number
}

/**
 * One entry per deletable status actually PRESENT, in `DELETABLE_STATUS_ORDER`.
 *
 * Counted against the list as it stands on screen (origin, facets and search already applied), so
 * a click promises exactly the rows the menu said it would take. Statuses with no row are absent
 * rather than shown as a zero — an option that can only ever delete nothing is a dead end wearing
 * a control's clothes.
 */
export function statusClearOptions(runs: readonly RunRecord[]): StatusClearOption[] {
  const counts = new Map<RunStatus, number>()
  for (const run of runs) {
    if (!isDeletableRun(run)) continue
    counts.set(run.status, (counts.get(run.status) ?? 0) + 1)
  }
  return DELETABLE_STATUS_ORDER.flatMap((status) => {
    const count = counts.get(status) ?? 0
    return count > 0 ? [{ status, count }] : []
  })
}

/** Every status, spelled as a translation key — the menu items, the confirm and the toast all read
 *  a status through this one map rather than each assembling a dotted key of its own. */
export const STATUS_TRANSLATION_KEYS: Record<RunStatus, TranslationKey> = {
  queued: 'tasks.status.queued',
  running: 'tasks.status.running',
  waiting: 'tasks.status.waiting',
  review: 'tasks.status.review',
  done: 'tasks.status.done',
  failed: 'tasks.status.failed',
  cancelled: 'tasks.status.cancelled',
}
