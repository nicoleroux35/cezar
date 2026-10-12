import { runnerSchema } from '@open-mercato/cezar-api-client'
import type { ProviderStatus, ProviderStatusResponse, Runner } from '@open-mercato/cezar-api-client'

/** The cockpit's canonical runner order, exported so a surface that renders one row per
 *  provider derives it instead of keeping a fifth hand-written copy — the copy in
 *  `accounts-section.tsx` silently dropped Copilot when #582 added it, and nothing in the
 *  type system noticed, because a `ProviderId[]` literal is under-wide, never wrong.
 *
 *  This is the order of the surfaces that render a LOGIN — the runner pills, the usable-runner
 *  list, the provider banner — and `http` is deliberately ABSENT from it. http is a real runner
 *  and a real `ProviderId`, so this list is a strict subset of {@link PROVIDER_ORDER}; the
 *  difference is that this omission is the point rather than an oversight. It has no CLI to sign
 *  into, no version and no per-CLI hook: it is configured, not connected. Putting it in the
 *  runner pills would offer a backend whose "login" is a JSON object.
 *
 *  It is NOT "every provider" — see {@link PROVIDER_ORDER} for that, and use it for anything
 *  that lists agents rather than logins. */
export const RUNNER_ORDER: readonly Runner[] = ['claude', 'codex', 'junie', 'opencode', 'cursor', 'pi', 'copilot', 'kilo', 'gemini', 'antigravity']

/**
 * EVERY agent backend in the cockpit's display order: the login order above, then whatever it does
 * not name (`http` today, and any backend a future contract adds).
 *
 * The tail is derived from the contract's own enum rather than spelled out, so a new provider is
 * listed the moment its schema lands and the two sides cannot drift — the exact failure the note
 * on `RUNNER_ORDER` records. This is the list for surfaces that list AGENTS (the Agent accounts
 * tabs, each with its own install state and config), the allowlist a `/providers/status` row is
 * validated against, and the order those rows are normalized into.
 *
 * Two lists rather than one because the two questions are genuinely different, and collapsing them
 * broke both ways round: gating the status parser on `RUNNER_ORDER` made the server's own http row
 * invalidate the entire response (blanking every provider surface at once), while putting http in
 * `RUNNER_ORDER` would offer it where only a login can go.
 */
export const PROVIDER_ORDER: readonly Runner[] = [
  ...RUNNER_ORDER,
  ...runnerSchema.options.filter((id) => !(RUNNER_ORDER as readonly string[]).includes(id)),
]

const PROVIDER_STATES = new Set(['connected', 'disconnected', 'not-installed', 'unknown'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export type ProviderStatusEventRow = Omit<ProviderStatus, 'enabled'> & { enabled?: boolean }

function parseProviderStatusRow(
  value: unknown,
  requireEnabled: boolean,
): ProviderStatusEventRow | null {
  if (!isRecord(value)) return null
  const { provider, status, enabled, hint, authFailureId } = value
  if (
    typeof provider !== 'string'
    || !PROVIDER_ORDER.includes(provider as Runner)
    || typeof status !== 'string'
    || !PROVIDER_STATES.has(status)
    || (requireEnabled && typeof enabled !== 'boolean')
    || (!requireEnabled && enabled !== undefined && typeof enabled !== 'boolean')
    || (hint !== undefined && typeof hint !== 'string')
    || (
      authFailureId !== undefined
      && (
        typeof authFailureId !== 'string'
        || authFailureId.length < 1
        || authFailureId.length > 128
        || status !== 'disconnected'
      )
    )
  ) return null
  return {
    provider: provider as Runner,
    status: status as ProviderStatus['status'],
    ...(typeof enabled === 'boolean' ? { enabled } : {}),
    ...(hint === undefined ? {} : { hint }),
    ...(authFailureId === undefined ? {} : { authFailureId }),
  }
}

export function parseProviderStatusEventRow(value: unknown): ProviderStatusEventRow | null {
  return parseProviderStatusRow(value, false)
}

function safeProviderRows(value: unknown, requireEnabled: boolean): ProviderStatusEventRow[] | null {
  if (!isRecord(value) || !Array.isArray(value.providers)) return null
  const rows: ProviderStatusEventRow[] = []
  const seen = new Set<string>()
  for (const valueRow of value.providers) {
    const row = parseProviderStatusRow(valueRow, requireEnabled)
    if (row === null || seen.has(row.provider)) return null
    seen.add(row.provider)
    rows.push(row)
  }
  return rows
}

function completeProviderRows(value: unknown): ProviderStatus[] | null {
  const rows = safeProviderRows(value, true)
  if (rows === null || rows.length === 0) return null
  const byProvider = new Map(rows.map((row) => [row.provider, row]))
  // Ordered by PROVIDER_ORDER, not RUNNER_ORDER: this is the list the cockpit reads back, and a
  // row it does not name (`http`) is still a row it must be able to find. Dropping them was the
  // bug this replaces — the server emits an http row, `providerStatusFor` is what the HTTP Agent's
  // provider card reads to say "Installed", and the parse threw for the WHOLE response.
  // It still cannot reach the runner pills: `usableRunners` filters back through RUNNER_ORDER.
  return PROVIDER_ORDER.flatMap((provider) => {
    const row = byProvider.get(provider)
    return row ? [row as ProviderStatus] : []
  })
}

export function parseProviderStatusResponse(value: unknown): ProviderStatusResponse {
  const rows = completeProviderRows(value)
  if (rows === null) {
    throw new Error('Invalid provider status response')
  }
  return { providers: rows }
}

export function applyProviderStatusRow(
  response: ProviderStatusResponse | undefined,
  row: ProviderStatusEventRow,
): ProviderStatusResponse | undefined {
  const providers = completeProviderRows(response)
  if (providers === null) return undefined
  return {
    providers: providers.map((candidate) => {
      if (candidate.provider !== row.provider) return candidate
      // An event row owns discovery/runtime status. Only enablement is additive because runtime
      // rows intentionally omit the workspace preference; carrying old hints or incident ids
      // through a connected recovery would otherwise leave another tab falsely red.
      return {
        provider: row.provider,
        status: row.status,
        enabled: row.enabled ?? candidate.enabled,
        ...(row.hint === undefined ? {} : { hint: row.hint }),
        ...(row.authFailureId === undefined ? {} : { authFailureId: row.authFailureId }),
      }
    }),
  }
}

/**
 * Fold a complete HTTP answer into the workspace cache. A row is authoritative only when its
 * cached value still matches the snapshot captured at request start; an SSE update in between
 * wins. Retry is the sole clearing exception, and it may clear only the id it submitted.
 */
export function mergeProviderStatusResponse(
  requestStart: ProviderStatusResponse | undefined,
  cached: ProviderStatusResponse | undefined,
  response: ProviderStatusResponse,
  retryIncidentId?: string,
): ProviderStatusResponse {
  const requestStartRows = completeProviderRows(requestStart)
  const cachedRows = completeProviderRows(cached)
  const responseRows = completeProviderRows(response)
  if (responseRows === null || cachedRows === null) return response
  if (requestStartRows === null) return { providers: cachedRows }
  const requestStartByProvider = new Map(requestStartRows.map((row) => [row.provider, row]))
  const cachedByProvider = new Map(cachedRows.map((row) => [row.provider, row]))

  return {
    providers: responseRows.map((incoming) => {
      const before = requestStartByProvider.get(incoming.provider)
      const current = cachedByProvider.get(incoming.provider)
      if (before === undefined || current === undefined) return current ?? incoming
      const retryClearsCurrent = retryIncidentId !== undefined
        && current.authFailureId === retryIncidentId
        && incoming.authFailureId === undefined
      const clearsDifferentIncident = retryIncidentId !== undefined
        && current.authFailureId !== undefined
        && current.authFailureId !== retryIncidentId
        && incoming.authFailureId === undefined
      if (clearsDifferentIncident) return current
      if (sameProviderStatusRow(before, current)) return incoming
      if (retryClearsCurrent) {
        return { ...incoming, enabled: current.enabled }
      }
      return current
    }),
  }
}

function sameProviderStatusRow(left: ProviderStatus, right: ProviderStatus): boolean {
  return left.provider === right.provider
    && left.status === right.status
    && left.enabled === right.enabled
    && left.hint === right.hint
    && left.authFailureId === right.authFailureId
}

export function usableRunners(status: ProviderStatusResponse | undefined): Runner[] {
  const rows = completeProviderRows(status)
  if (rows === null) return []
  const usable = new Set(
    rows
      .filter((row) => row.enabled && (
        row.status === 'connected'
        // Junie has no read-only auth-status command. Its probe can confirm the CLI is installed,
        // but must report auth as unknown rather than guess; allow selection and let ACP surface
        // any required authentication at run time.
        || (row.provider === 'junie' && row.status === 'unknown')
      ))
      .map((row) => row.provider),
  )
  return RUNNER_ORDER.filter((runner) => usable.has(runner))
}

export function providerStatusFor(
  status: ProviderStatusResponse | undefined,
  provider: Runner,
): ProviderStatus | undefined {
  return completeProviderRows(status)?.find((row) => row.provider === provider)
}
