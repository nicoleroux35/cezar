import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, ExternalLinkIcon, MinusIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { E2E_CREDENTIAL_NAMES, queryScope, type E2eCredentialName, type RunStatus } from '@open-mercato/cezar-api-client'
import { startE2eSetup } from '@/api/client'
import { queryKeys, useE2eStatus, useRun } from '@/api/queries'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { scopeTo } from '@/lib/project-router'
import testerArmyLogo from '@/assets/integrations/tester-army.png'
import { useTranslations } from '@/i18n/use-translations'

/** TesterArmy's own repository — where the card sends someone who wants to know what e2e is. */
export const TESTER_ARMY_REPO = 'https://github.com/tester-army/e2e'

/** The provider behind each key, as the person picking one knows it. */
const PROVIDER_LABELS: Record<E2eCredentialName, string> = {
  AI_GATEWAY_API_KEY: 'Vercel AI Gateway',
  OPENAI_API_KEY: 'OpenAI',
  ANTHROPIC_API_KEY: 'Anthropic',
  OPENROUTER_API_KEY: 'OpenRouter',
}

const IN_FLIGHT: ReadonlySet<RunStatus> = new Set(['queued', 'running', 'waiting'])

/**
 * What a setup run's status means for the person waiting on it. A finished setup whose config is
 * not in the checkout yet has one step left — merging its branch — because the review gate is
 * off by default and `done` alone would read as "nothing left to do".
 */
function setupLine(tr: (text: any) => string, status: RunStatus, landed: boolean, branch: string | undefined, prUrl: string | undefined): string {
  if (IN_FLIGHT.has(status)) return tr('Setting up — cezar is installing and configuring e2e in its own worktree.')
  const mergeIt = prUrl
    ? tr('its draft PR is ready — merge it to finish.')
    : `${tr('merge')} ${branch ? `${tr('branch')} ${branch}` : tr('the setup task’s branch')} ${tr('to finish.')}`
  if (status === 'review') return `${tr('Ready for review —')} ${mergeIt}`
  if (status === 'done') return landed ? tr('Setup finished.') : `${tr('Setup finished —')} ${mergeIt}`
  if (status === 'failed') return tr('The last setup failed — open the task to see why, then try again.')
  return tr('The last setup was cancelled.')
}

function Row({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-sm" data-ok={ok}>
      {ok ? <CheckIcon className="size-4 text-success" aria-hidden /> : <MinusIcon className="size-4 text-muted-foreground" aria-hidden />}
      <span className={ok ? undefined : 'text-muted-foreground'}>{children}</span>
    </li>
  )
}

/**
 * Settings → project → External integrations → Test frameworks → TesterArmy e2e (spec
 * 2026-10-10-e2e-one-click-setup). One button: cezar
 * installs and configures TesterArmy's `e2e` as a task whose branch the user merges. The model key
 * is optional — smoke tests run without one — and goes to the project's secret store for check
 * steps only, never to an agent.
 */
export function TesterArmyE2eCard() {
  const { tr } = useTranslations()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const status = useE2eStatus()
  // The run record is what the event stream keeps live; the status payload is a snapshot.
  const setupRun = useRun(status.data?.setup?.runId)
  // Until the user picks one, the provider follows the key already stored (else the AI Gateway,
  // `e2e init`'s own default) — re-running a setup should not quietly switch providers.
  const [chosenProvider, setProvider] = useState<E2eCredentialName | undefined>(undefined)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  const setupStatus = setupRun.data?.status ?? status.data?.setup?.status
  // http(s) only (#431): the URL is written by `gh`, but a link is still a link.
  const prUrl = setupRun.data?.pullRequestUrl && /^https?:\/\//.test(setupRun.data.pullRequestUrl) ? setupRun.data.pullRequestUrl : undefined
  const inFlight = setupStatus !== undefined && IN_FLIGHT.has(setupStatus)
  const credentials = status.data?.credentials ?? []
  const provider: E2eCredentialName = chosenProvider ?? credentials[0] ?? 'AI_GATEWAY_API_KEY'
  const installed = Boolean(status.data?.configFile && status.data.workflow)

  const starting = useMutation({
    mutationFn: async () => {
      const projectId = queryScope()
      const response = await startE2eSetup(key ? { credential: { name: provider, value: key } } : {})
      return { projectId, runId: response.runId }
    },
    onSuccess: async ({ projectId, runId }) => {
      setKey('')
      setError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.e2e.allFor(projectId ?? '') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.secrets.allFor(projectId ?? '') }),
      ])
      toast(tr('e2e setup started'))
      if (queryScope() === projectId) void navigate(scopeTo(projectId, `/tasks/${runId}`))
    },
    // Keep the key on failure: a transient 409 should not cost a re-paste.
    onError: (e: Error) => setError(e.message),
  })

  const badge = inFlight ? tr('Setting up') : installed ? tr('Installed') : tr('Not set up')
  return (
    <div className="flex flex-col gap-4" data-slot="e2e-settings">
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <img src={testerArmyLogo} alt="" width={40} height={40} className="size-10 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{tr('TesterArmy e2e')}</h2>
              <span data-slot="e2e-badge" data-state={inFlight ? 'setting-up' : installed ? 'installed' : 'none'}
                className={installed && !inFlight
                  ? 'rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success'
                  : 'rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'}>
                {badge}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{tr('Agentic browser end-to-end testing')}</p>
          </div>
          <a href={TESTER_ARMY_REPO} target="_blank" rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            tester-army/e2e <ExternalLinkIcon className="size-3" aria-hidden />
          </a>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {tr('cezar installs it for this project, points it at your dev server, writes a smoke test and an')}
          {' '}<code>implement-and-e2e</code> {tr('workflow, proves it all passes in a real browser and opens a draft PR for you to merge.')}
        </p>
        {status.isPending ? <p className="mt-4 text-sm text-muted-foreground">{tr('Loading…')}</p> : null}
        {status.isError ? <p role="alert" className="mt-4 text-sm text-danger">{status.error.message}</p> : null}
        {status.data ? (
          <ul className="mt-4 flex flex-col gap-1.5" aria-label={tr('e2e status')}>
            <Row ok={Boolean(status.data.configFile)}>{status.data.configFile ? <>{tr('Configured')} (<code>{status.data.configFile}</code>)</> : tr('Not configured in this checkout')}</Row>
            <Row ok={status.data.workflow}><code>implement-and-e2e</code> {tr('workflow')} {status.data.workflow ? tr('available') : tr('not added yet')}</Row>
            <Row ok={credentials.length > 0}>
              {credentials.length > 0
                ? <>{tr('Model key:')} <code>{credentials.join(', ')}</code></>
                : tr('No model key — smoke tests run without one; agent steps need one')}
            </Row>
          </ul>
        ) : null}
        {status.data?.setup && setupStatus ? (
          <p className="mt-3 text-sm" data-slot="e2e-setup-run" data-status={setupStatus}>
            {setupLine(tr, setupStatus, Boolean(status.data.configFile), setupRun.data?.branch, prUrl)}{' '}
            {prUrl && !status.data.configFile ? (
              <><a className="underline" href={prUrl} target="_blank" rel="noreferrer">{tr('Open the draft PR')}</a>{' · '}</>
            ) : null}
            <Link className="underline" to={scopeTo(queryScope(), `/tasks/${status.data.setup.runId}`)}>{tr('Open the setup task')}</Link>
          </p>
        ) : null}
      </section>

      <form className="rounded-lg border border-border bg-card p-4" autoComplete="off" onSubmit={(event) => { event.preventDefault(); starting.mutate() }}>
        <h2 className="text-sm font-semibold">{installed ? tr('Set up again') : tr('Set up e2e')}</h2>
        <label className="mt-3 block text-sm">{tr('Model provider')}
          <select aria-label={tr('Model provider')} value={provider} onChange={(event) => setProvider(event.target.value as E2eCredentialName)}
            className="mt-1 block w-full rounded border border-border bg-background p-2 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
            {E2E_CREDENTIAL_NAMES.map((name) => (
              <option key={name} value={name}>{PROVIDER_LABELS[name]} ({name}){credentials.includes(name) ? ` — ${tr('stored')}` : ''}</option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-sm">{tr('API key')} <span className="text-muted-foreground">({tr('optional')})</span>
          <input aria-label={tr('API key')} type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)}
            placeholder={credentials.includes(provider) ? tr('stored — leave empty to keep it') : ''}
            className="mt-1 block w-full rounded border border-border bg-background p-2" />
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          {tr('Stored encrypted as a project secret for check steps only — never handed to an agent session.')}
        </p>
        {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
        <div className="mt-3">
          <Button type="submit" disabled={starting.isPending || inFlight || !status.data}>
            {inFlight ? tr('Setup in progress…') : installed ? tr('Set up again') : tr('Set up e2e')}
          </Button>
        </div>
      </form>
    </div>
  )
}
