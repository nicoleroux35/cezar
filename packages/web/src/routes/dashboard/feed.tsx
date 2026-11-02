import { DisclosureChevron, disclosureSummary, widgetHeading } from './presentation'
import { ExportRows } from './export-rows'
import { useContext, useLayoutEffect, useMemo, useRef } from 'react'
import type { DashboardFeed, DashboardFeedRow } from '@open-mercato/cezar-api-client'
import { useDashboardFeed } from '@/api/dashboard'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { SegmentedControl } from '@/components/facet-filter'
import { shortAge } from '@/lib/format'
import { TaskRow, Coverage } from './rows'
import { DashboardEntryContext, readPanel, savePanel, useStagedRows } from './state'
import { useTranslations } from '@/i18n/use-translations'
function sourceLabel(key: string) {
  if (!key.startsWith('github:')) return key === 'tasks' ? 'Task results' : key
  const parts = key.slice(7).split(':')
  const kind = parts.pop() === 'pr' ? 'Pull requests' : 'Issues'
  const name = parts
    .join(':')
    .replace(/^project:/, 'Project ')
    .replace(/^github.com\//, '')
  return `${name} · ${kind}`
}
const feedKey = (row: DashboardFeedRow) => row.key
export function Feed({
  filter,
  setFilter,
  count,
  more,
}: {
  filter: DashboardFeed['filter']
  setFilter: (value: DashboardFeed['filter']) => void
  count: number
  more: () => void
}) {
  const { tr } = useTranslations()
  const query = useDashboardFeed(filter, true)
  const staged = useStagedRows(
    query.data?.rows, feedKey, `feed:${filter}`, 0,
    (row) => row.kind === 'task-result',
  )
  // Detached GitHub rows disappear immediately; task results retain reconciliation labels.
  const rows = staged.rows
  const updates = staged.updates
  const entry = useContext(DashboardEntryContext)
  const list = useRef<HTMLDivElement>(null)
  const scrollKey = `feed:${filter}`
  const restore = useMemo(() => ({
    scroll: readPanel(entry, scrollKey)?.scroll ?? 0,
    done: false,
  }), [entry, scrollKey])
  useLayoutEffect(() => {
    if (!list.current || restore.done) return
    list.current.scrollTop = restore.scroll
    // Cached rows may arrive after mounting; retry once the list can reach its position.
    restore.done = Math.abs(list.current.scrollTop - restore.scroll) < 1 ||
      (!!query.data && !query.isPending && !query.isFetching)
  }, [restore, rows.length, count, query.data, query.isPending, query.isFetching])
  const heading = useRef<HTMLHeadingElement>(null)
  const github = query.data?.sources.filter((s) => s.key.startsWith('github:')) ?? []
  const fetched = github.flatMap((s) => (s.fetchedAt ? [s.fetchedAt] : [])).sort()[0]
  const githubFailed = query.githubError
  const unconfigured = github.filter((s) => s.reason === 'No GitHub remote')
  const loading = github.some((s) => s.reason === 'Still loading GitHub')
  const noGithub = github.length > 0 && unconfigured.length === github.length && !githubFailed
  const errors = github.filter(
    (s) =>
      s.state !== 'ready' &&
      s.reason !== 'No GitHub remote' &&
      s.reason !== 'Still loading GitHub',
  )
  const tasksOnly = noGithub && filter === 'all'
  return (
    <Card
      data-export-context={`Results source: ${filter}; Last 7 days; loaded ${Math.min(count, rows.length)} rows`}
      className="min-w-0 gap-0 overflow-hidden py-0"
    >
      <div className="space-y-2 border-b px-4 pt-2.5 pb-2">
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
          <h2 ref={heading} tabIndex={-1} className={widgetHeading}>
            {tasksOnly ? tr('Recent results') : tr('Recent results & GitHub')}
          </h2>
          <span className="font-mono text-meta text-soft-foreground">Last 7 days</span>
        </div>
        {!tasksOnly && (
          <SegmentedControl
            slot="dashboard-feed"
            label={tr('Results source')}
            value={filter}
            options={[
              { value: 'all', label: tr('All') },
              { value: 'tasks', label: tr('Tasks') },
              { value: 'github', label: tr('GitHub') },
            ]}
            onChange={setFilter}
          />
        )}
        {tasksOnly && (
          <p className="text-xs text-muted-foreground">
            {tr('Task results · No GitHub repositories configured')}
          </p>
        )}
        {filter !== 'tasks' && !tasksOnly && (
          <details
            className="text-xs text-muted-foreground"
            open={errors.length || githubFailed ? true : undefined}
          >
            <summary className={`${disclosureSummary} py-1.5`}>
              <DisclosureChevron />
              {errors.length || githubFailed
                ? tr('GitHub needs attention')
                : loading
                  ? tr('Checking GitHub…')
                  : noGithub
                    ? tr('GitHub not configured')
                    : fetched
                      ? `${tr('GitHub checked')} ${shortAge(fetched)} ${tr('ago')}`
                      : tr('GitHub source')}
            </summary>
            <div className="flex flex-wrap items-center justify-between gap-x-3">
              <p>
                {errors.length || githubFailed
                  ? fetched
                    ? `${tr('Could not refresh GitHub. Showing results from')} ${new Date(fetched).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
                    : tr('Could not load one or more GitHub sources.')
                  : loading
                    ? tr('Checking repository sources. Available results remain visible.')
                    : noGithub
                      ? tr('No GitHub repositories configured. Select Tasks to see task results.')
                      : fetched
                        ? `${tr('GitHub checked')} ${shortAge(fetched)} ${tr('ago')}`
                        : tr('GitHub snapshot')}
              </p>
              {!noGithub && (
                <Button
                  variant="ghost"
                  className="min-h-11 px-0"
                  disabled={query.githubFetching}
                  onClick={() => {
                    void query.refetch()
                  }}
                >
                  {query.githubFetching
                    ? tr('Refreshing…')
                    : errors.length || githubFailed
                      ? tr('Retry GitHub')
                      : tr('Refresh GitHub')}
                </Button>
              )}
            </div>
          </details>
        )}
      </div>
      <div
        role="region"
        aria-label={tr('Recent results list')}
        ref={list}
        onWheel={() => { restore.done = true }}
        onTouchStart={() => { restore.done = true }}
        onKeyDown={() => { restore.done = true }}
        onScroll={(event) => {
          if (entry && restore.done)
            savePanel(entry, scrollKey, { count, scroll: event.currentTarget.scrollTop })
        }}
        tabIndex={0}
        className="max-h-80 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {query.isError && (
          <p role="alert" className="p-4 text-sm">
            {tr('Could not load results.')}{' '}
            <Button
              className="min-h-11"
              onClick={() => {
                void query.retryFailed()
              }}
            >
              {tr('Retry')}
            </Button>
          </p>
        )}
        {query.isPending && <p className="p-4 text-sm">{tr('Loading results…')}</p>}
        {updates > 0 && (
          <Button
            variant="ghost"
            className="m-2 min-h-11"
            onClick={() => {
              staged.show()
              heading.current?.focus()
            }}
          >
            {updates} {tr('updates — Show')}
          </Button>
        )}
        {rows.slice(0, count).map(({ row, removed }) =>
          row.kind === 'task-result' ? (
            <TaskRow
              key={row.key}
              row={row.run}
              kicker={
                removed
                  ? tr('Outside current results')
                  : `${tr('Latest result:')} ${row.run.status === 'failed' ? tr('Failed') : tr('Completed')}`
              }
            />
          ) : (
            <div key={row.key} className="border-b px-4 py-3 transition-colors hover:bg-muted/30">
              <ExportRows
                rows={[
                  {
                    section: 'github',
                    entity: `${row.repo}#${row.number}`,
                    metric: row.itemKind,
                    value: row.title,
                    asOf: row.at,
                    note: row.url,
                  },
                ]}
              />
              <a
                className="block break-words text-sm font-medium hover:underline no-hover:min-h-11"
                href={row.url}
                target="_blank"
                rel="noreferrer"
              >
                {row.title}
              </a>
              <p className="mt-1 text-xs text-muted-foreground">
                {row.repo} · {row.itemKind === 'pr' ? 'PR' : tr('Issue')} #{row.number} {tr('created')} ·{' '}
                {shortAge(row.at)}
              </p>
            </div>
          ),
        )}
        {query.data &&
          !query.data.rows.length &&
          !rows.length &&
          !query.isFetching &&
          !query.isError &&
          !errors.length &&
          !loading &&
          query.data.coverage.projects.every((p) => p.state === 'complete') && (
            <p className="px-4 py-8 text-sm text-muted-foreground">{tr('No results in the last 7 days')}</p>
          )}
        {count < rows.length && (
          <Button variant="ghost" className="m-2 min-h-11" onClick={more}>
            {tr('Show')} {Math.min(20, rows.length - count)} {tr('more results')}
          </Button>
        )}
        {query.data?.truncated && <p className="p-4 text-xs">{tr('Showing the latest 60 results')}</p>}
        {query.data && (
          <Coverage
            coverage={query.data.coverage}
            retry={() => {
              void query.retryTasks()
            }}
          />
        )}
        {!tasksOnly && query.data?.sources.some((s) => s.state !== 'ready' || s.truncated) && (
          <details className="p-4 text-xs">
            <summary className={`${disclosureSummary} min-h-11`}>
              <DisclosureChevron />
              {tr('Source details')}
            </summary>
            {query.data.sources.map((s) => (
              <p className="break-words py-1" key={s.key}>
                {sourceLabel(s.key)}:{' '}
                {s.reason === 'No GitHub remote'
                  ? tr('Not configured')
                  : s.reason === 'Still loading GitHub'
                    ? tr('Checking…')
                    : (s.reason ?? (s.state === 'ready' ? tr('Up to date') : s.state))}
                {s.truncated ? ` · ${tr('capped')}` : ''}
                {s.fetchedAt ? ` · ${tr('checked')} ${shortAge(s.fetchedAt)}` : ''}
              </p>
            ))}
          </details>
        )}
      </div>
    </Card>
  )
}
