import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type {
  DashboardAutomationStat,
  DashboardBackendStat,
  DashboardFailureReason,
  DashboardInsights,
} from '@open-mercato/cezar-api-client'
import { useDashboardInsights } from '@/api/dashboard-insights'
import { useProjects } from '@/api/queries'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { StatusDot } from '@/components/status-dot'
import { compactTokens, shortAge } from '@/lib/format'
import { useAutomationsGate } from '@/routes/automations/use-automations'
import { useDashboardAutomations } from './automations-data'
import { ExportRows } from './export-rows'
import { Coverage } from './rows'
import { formatAmount, formatHours } from './format'
import { FilterSelect, filterLabel, Freshness, widgetHeader, widgetHeading } from './presentation'
import { useDashboardFilter } from './url-filter'
import { useTranslations } from '@/i18n/use-translations'

type Period = DashboardInsights['period']
const periodText = (period: Period) => `Last ${period === '7d' ? 7 : 30} calendar days`
const bandLabel = 'eyebrow text-muted-foreground'
const panel = 'min-w-0 rounded-lg border bg-card-2 p-4'
const th =
  'whitespace-nowrap px-3 py-2 eyebrow text-soft-foreground'

function useProjectName() {
  const projects = useProjects().data?.projects
  return (id: string) => projects?.find((p) => p.id === id)?.name ?? id
}
const taskPath = (projectId: string, id: string) =>
  `/p/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(id)}`

function PeriodSelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: Period
  onChange: (value: Period) => void
}) {
  const { tr } = useTranslations()
  return (
    <label className={filterLabel}>
      {label}
      <FilterSelect value={value} onChange={(e) => onChange(e.target.value === '30d' ? '30d' : '7d')}>
        <option value="7d">{tr('Last 7 days')}</option>
        <option value="30d">{tr('Last 30 days')}</option>
      </FilterSelect>
    </label>
  )
}

function InsightState({ query }: { query: ReturnType<typeof useDashboardInsights> }) {
  const { tr } = useTranslations()
  if (query.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {tr('Loading insights…')}
      </p>
    )
  if (!query.isError) return null
  return (
    <p role="alert" className="text-sm">
      {query.data ? `${tr('Showing previous results.')} ` : ''}{tr('Could not refresh insights.')}{' '}
      <Button variant="outline" onClick={() => void query.refetch()}>
        {tr('Retry insights')}
      </Button>
    </p>
  )
}

/** Delivered work and failure reasons: the two answers under the overview's outcome tiles. */
export function OutcomeInsights({ period, active }: { period: Period; active: boolean }) {
  const query = useDashboardInsights(period, active)
  const data = query.data
  return (
    <div className="space-y-3">
      <InsightState query={query} />
      {data && <Coverage coverage={data.coverage} retry={() => void query.refetch()} />}
      {data && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Delivered data={data} />
          <FailureReasons data={data} />
        </div>
      )}
    </div>
  )
}

/** A quarter-width stat cell fits ~7 digits; past 10k show `193.7k` and keep the exact count in the tooltip. */
function Count({ value, prefix = '', className }: { value: number; prefix?: string; className?: string }) {
  const exact = `${prefix}${value.toLocaleString('en-US')}`
  if (value < 10_000) return <span className={className}>{exact}</span>
  return (
    <span className={className} title={exact}>
      {prefix}
      {compactTokens(value)}
    </span>
  )
}

function Delivered({ data }: { data: DashboardInsights }) {
  const { tr } = useTranslations()
  const d = data.delivered
  const stats: { label: string; value: ReactNode; note?: string }[] = [
    { label: tr('PRs opened'), value: d.prsOpened, note: `${d.prsTouched} ${tr('touched')}` },
    {
      label: tr('Lines'),
      value: (
        <span className="flex flex-wrap gap-x-1.5">
          <Count value={d.additions} prefix="+" className="text-success" />
          <Count value={d.deletions} prefix="−" className="text-danger" />
        </span>
      ),
    },
    { label: tr('Files'), value: d.files.toLocaleString('en-US') },
    { label: tr('Issues'), value: d.issues },
  ]
  return (
    <section className={panel} aria-label={tr('Delivered')}>
      <ExportRows
        rows={Object.entries(d).map(([metric, value]) => ({
          section: 'delivered',
          metric,
          value,
          unit: ['additions', 'deletions'].includes(metric)
            ? 'lines'
            : metric === 'files'
              ? 'files'
              : 'count',
          asOf: data.asOf,
          note: `Completed since ${data.windowStart}`,
        }))}
      />
      <h3 className={bandLabel}>{tr('Delivered')}</h3>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0">
            <dt className="text-xs text-soft-foreground">{s.label}</dt>
            <dd className="mt-1 truncate text-xl font-semibold tracking-tight tabular-nums">
              {s.value}
            </dd>
            {s.note && <dd className="text-xs text-soft-foreground">{s.note}</dd>}
          </div>
        ))}
      </dl>
      <span className="mt-3 block text-xs text-soft-foreground">
        {tr('From')} {d.completedTasks} {tr('completed')} {d.completedTasks === 1 ? tr('task') : tr('tasks')} ·{' '}
        {d.measuredTasks} {tr('with a stored diff')}
      </span>
    </section>
  )
}

function FailureReasons({ data }: { data: DashboardInsights }) {
  const { tr } = useTranslations()
  const projectName = useProjectName()
  const { total, reasons } = data.failures
  return (
    <section className={panel} aria-label={tr('Why tasks failed')}>
      <ExportRows
        rows={reasons.map((r) => ({
          section: 'failures',
          entity: r.label,
          metric: r.category,
          value: r.count,
          unit: 'tasks',
          asOf: data.asOf,
          note: r.latest.message,
        }))}
      />
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={bandLabel}>{tr('Why tasks failed')}</h3>
        {total > 0 && (
          <span className="font-mono text-meta text-soft-foreground">{total} failed</span>
        )}
      </div>
      {total === 0 ? (
        <span className="mt-4 flex items-center gap-2.5 text-sm text-muted-foreground">
          <StatusDot tone="success" />
          {tr('No failed outcomes in this period')}
        </span>
      ) : (
        <ul className="mt-3 space-y-3">
          {reasons.map((reason) => (
            <FailureReason
              key={`${reason.category}:${reason.label}`}
              reason={reason}
              total={total}
              projectName={projectName}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function FailureReason({
  reason,
  total,
  projectName,
}: {
  reason: DashboardFailureReason
  total: number
  projectName: (id: string) => string
}) {
  const { tr } = useTranslations()
  const { latest } = reason
  return (
    <li className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium" title={reason.label}>
          {reason.label}
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{reason.count}</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-danger/70" style={{ width: `${(reason.count / total) * 100}%` }} />
      </div>
      <span className="mt-1.5 block truncate text-xs text-soft-foreground" title={latest.message}>
        {tr('Latest:')}{' '}
        <Link className="text-muted-foreground hover:text-foreground hover:underline" to={taskPath(latest.projectId, latest.id)}>
          {latest.title}
        </Link>{' '}
        · {projectName(latest.projectId)}
        {latest.step ? ` · ${latest.step}` : ''} · {shortAge(latest.at)} {tr('ago')}
      </span>
    </li>
  )
}

const backendNames: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  pi: 'Pi',
  unknown: 'Unknown backend',
  mixed: 'Mixed backends',
}
const backendName = (id: string) => backendNames[id] ?? id
const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0)

/** Which backend and model finish work, how fast, and at what reported cost. */
export function BackendComparison() {
  const { tr } = useTranslations()
  const [period, setPeriod] = useDashboardFilter('backends', ['7d', '30d'] as const, '7d')
  const query = useDashboardInsights(period)
  const data = query.data
  const cost = data?.visibility.cost
  return (
    <section data-dashboard-module="backends" className="min-w-0">
    <Card className="gap-0 py-0" data-export-context={`Backends: ${periodText(period)}; finished tasks`}>
      <div className={widgetHeader}>
        <h2 className={widgetHeading}>{tr('Backends & models')}</h2>
        <PeriodSelect label={tr('Finished')} value={period} onChange={setPeriod} />
      </div>
      <div className="space-y-3 p-4">
        <InsightState query={query} />
        {data && (
          <>
            <p className="text-xs text-muted-foreground">
              {tr('Tasks that finished done or failed in the period, by the backend and model their steps ran on. Includes subtasks. Cost is reported USD only.')}
            </p>
            <Coverage coverage={data.coverage} retry={() => void query.refetch()} />
            {data.backends.length ? (
              <div className="overflow-x-auto" role="region" aria-label={tr('Backend comparison')} tabIndex={0}>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className={th}>{tr('Backend')}</th>
                      <th className={`${th} text-right`}>{tr('Finished')}</th>
                      <th className={th}>{tr('Success')}</th>
                      <th className={`${th} text-right`}>{tr('Median cycle')}</th>
                      {cost && <th className={`${th} text-right`}>{tr('Reported USD')}</th>}
                      {cost && <th className={`${th} text-right`}>{tr('Per completed')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.backends.map((b) => (
                      <BackendRow key={`${b.backend}:${b.model ?? ''}`} stat={b} cost={!!cost} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">{tr('No finished tasks in this period.')}</p>
            )}
            <span className="block font-mono text-meta text-soft-foreground">
              <Freshness at={data.asOf} />
            </span>
            <ExportRows
              rows={data.backends.flatMap((b) =>
                (['finished', 'done', 'failed', 'medianCycleHours'] as const).map((metric) => ({
                  section: 'backends',
                  entity: `${b.backend}${b.model ? `:${b.model}` : ''}`,
                  metric,
                  value: b[metric],
                  unit: metric === 'medianCycleHours' ? 'hours' : 'tasks',
                  asOf: data.asOf,
                })),
              )}
            />
          </>
        )}
      </div>
    </Card>
    </section>
  )
}

function BackendRow({ stat: b, cost }: { stat: DashboardBackendStat; cost: boolean }) {
  const { tr } = useTranslations()
  const rate = percent(b.done, b.finished)
  const usd = b.costUsd?.value
  return (
    <tr className="border-t transition-colors hover:bg-muted/30">
      <td className="px-3 py-2.5">
        <span className="block font-medium">{backendName(b.backend)}</span>
        <span className="block font-mono text-meta text-soft-foreground">
          {b.backend === 'mixed' ? tr('steps ran on different backends') : (b.model ?? tr('default model'))}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{b.finished}</td>
      <td className="min-w-40 px-3 py-2.5">
        <span className="flex items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-danger/40" aria-hidden="true">
            <span className="block h-full rounded-full bg-success" style={{ width: `${rate}%` }} />
          </span>
          <span className="w-10 text-right font-mono text-xs tabular-nums">{rate}%</span>
        </span>
        <span className="block text-xs text-soft-foreground">
          {b.done} done · {b.failed} failed
        </span>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {b.timedTasks ? formatHours(b.medianCycleHours) : '—'}
      </td>
      {cost && (
        <td className="px-3 py-2.5 text-right tabular-nums">
          {usd == null ? '—' : formatAmount(usd, true)}
          <span className="block text-xs text-soft-foreground">
            {b.costUsd?.reportedTasks ?? 0}/{b.finished} reported
          </span>
        </td>
      )}
      {cost && (
        <td className="px-3 py-2.5 text-right tabular-nums">
          {usd == null || !b.done ? '—' : formatAmount(usd / b.done, true)}
        </td>
      )}
    </tr>
  )
}

type AutomationRow = {
  projectId: string
  automationId: string
  name: string
  enabled?: boolean
  /** `removed` only when the project's definitions were READ and it is not among them; a
   *  failed or pending read is `unknown` — never report a deletion we did not observe. */
  definition: 'known' | 'removed' | 'unknown'
  stat?: DashboardAutomationStat
}

/** What each automation launched in the period, including the ones that launched nothing. */
export function AutomationOutcomes() {
  const { tr } = useTranslations()
  const [period, setPeriod] = useDashboardFilter('automations', ['7d', '30d'] as const, '7d')
  const gate = useAutomationsGate()
  const query = useDashboardInsights(period)
  const definitions = useDashboardAutomations(gate.known && !gate.off)
  const projectName = useProjectName()
  const data = query.data
  const cost = data?.visibility.cost
  const rows = new Map<string, AutomationRow>()
  for (const project of definitions.data ?? [])
    for (const a of project.data?.automations ?? [])
      rows.set(`${project.id}\u0000${a.id}`, {
        projectId: project.id,
        automationId: a.id,
        name: a.name,
        enabled: a.enabled,
        definition: 'known',
      })
  const read = new Set(
    (definitions.data ?? []).flatMap((project) => (project.data && !project.error ? [project.id] : [])),
  )
  const detailsFailed =
    definitions.isError ||
    definitions.registry.isError ||
    (definitions.data ?? []).some((project) => project.error)
  for (const stat of data?.automations ?? []) {
    const key = `${stat.projectId}\u0000${stat.automationId}`
    const known = rows.get(key)
    rows.set(
      key,
      known
        ? { ...known, stat }
        : {
            ...stat,
            name: stat.automationId,
            definition: read.has(stat.projectId) ? 'removed' : 'unknown',
            stat,
          },
    )
  }
  const sorted = [...rows.values()].sort(
    (a, b) =>
      (b.stat?.tasks ?? 0) - (a.stat?.tasks ?? 0) ||
      Number(b.enabled ?? false) - Number(a.enabled ?? false) ||
      a.name.localeCompare(b.name),
  )
  return (
    <section data-dashboard-module="automation-outcomes" className="min-w-0">
    <Card className="gap-0 py-0" data-export-context={`Automation outcomes: tasks created in ${periodText(period)}`}>
      <div className={widgetHeader}>
        <h2 className={widgetHeading}>{tr('Automation outcomes')}</h2>
        <PeriodSelect label={tr('Launched')} value={period} onChange={setPeriod} />
      </div>
      <div className="space-y-3 p-4">
        {gate.off ? (
          <p className="text-sm text-muted-foreground">{tr('Automations are disabled in this workspace.')}</p>
        ) : (
          <>
            <InsightState query={query} />
            {data && (
              <>
                <p className="text-xs text-muted-foreground">
                  {tr('Tasks each automation created in the period and how they ended. Active means still running, queued, waiting on you, or waiting to resume after a usage limit.')}
                </p>
                <Coverage coverage={data.coverage} retry={() => void query.refetch()} />
                {detailsFailed && (
                  <p role="alert" className="text-sm">
                    {tr('Some automation details could not be loaded. Their outcomes are shown by id.')}{' '}
                    <Button variant="ghost" onClick={definitions.retry}>
                      {tr('Retry automations')}
                    </Button>
                  </p>
                )}
                {sorted.length ? (
                  <div className="overflow-x-auto" role="region" aria-label={tr('Automation outcomes')} tabIndex={0}>
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr>
                          <th className={th}>{tr('Automation')}</th>
                          <th className={`${th} text-right`}>{tr('Tasks')}</th>
                          <th className={`${th} text-right`}>{tr('Done')}</th>
                          <th className={`${th} text-right`}>{tr('Failed')}</th>
                          <th className={`${th} text-right`}>{tr('Active')}</th>
                          <th className={th}>{tr('Last run')}</th>
                          {cost && <th className={`${th} text-right`}>{tr('Reported USD')}</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map((row) => (
                          <AutomationOutcome
                            key={`${row.projectId}:${row.automationId}`}
                            row={row}
                            cost={!!cost}
                            projectName={projectName}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="py-4 text-sm text-muted-foreground">
                    {tr("No automations yet. Create one in a project's Automations page.")}
                  </p>
                )}
                <span className="block font-mono text-meta text-soft-foreground">
                  <Freshness at={data.asOf} />
                </span>
                <ExportRows
                  rows={sorted.flatMap((row) =>
                    (['tasks', 'done', 'failed', 'active'] as const).map((metric) => ({
                      section: 'automation-outcomes',
                      entity: `${row.projectId}:${row.automationId}`,
                      metric,
                      value: row.stat?.[metric] ?? 0,
                      unit: 'tasks',
                      asOf: data.asOf,
                      note: row.name,
                    })),
                  )}
                />
              </>
            )}
          </>
        )}
      </div>
    </Card>
    </section>
  )
}

function AutomationOutcome({
  row,
  cost,
  projectName,
}: {
  row: AutomationRow
  cost: boolean
  projectName: (id: string) => string
}) {
  const { tr } = useTranslations()
  const s = row.stat
  const cell = 'px-3 py-2.5 text-right tabular-nums'
  const zero = (n: number | undefined) => (n ? n : <span className="text-soft-foreground">0</span>)
  return (
    <tr className="border-t transition-colors hover:bg-muted/30">
      <td className="px-3 py-2.5">
        {row.definition === 'removed' ? (
          <span className="block font-medium">{row.name}</span>
        ) : (
          <Link
            className="block font-medium hover:underline"
            to={`/p/${encodeURIComponent(row.projectId)}/automations/${encodeURIComponent(row.automationId)}`}
          >
            {row.name}
          </Link>
        )}
        <span className="flex items-center gap-1.5 text-xs text-soft-foreground">
          <StatusDot tone={row.enabled ? 'success' : 'neutral'} />
          {projectName(row.projectId)} ·{' '}
          {row.definition === 'removed'
            ? 'Removed'
            : row.definition === 'unknown'
              ? 'Details unavailable'
              : row.enabled
                ? 'Enabled'
                : 'Disabled'}
        </span>
      </td>
      <td className={cell}>{zero(s?.tasks)}</td>
      <td className={cell}>{zero(s?.done)}</td>
      <td className={`${cell} ${s?.failed ? 'text-danger' : ''}`}>{zero(s?.failed)}</td>
      <td className={cell}>{zero(s?.active)}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
        {s?.lastRunAt ? (
          <time dateTime={s.lastRunAt} title={new Date(s.lastRunAt).toLocaleString()}>
            {shortAge(s.lastRunAt)} ago · {s.lastStatus}
          </time>
        ) : (
          '—'
        )}
      </td>
      {cost && (
        <td className={cell}>
          {s?.costUsd?.value == null ? '—' : formatAmount(s.costUsd.value, true)}
        </td>
      )}
    </tr>
  )
}
