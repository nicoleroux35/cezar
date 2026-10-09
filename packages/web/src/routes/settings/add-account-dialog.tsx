import { useState } from 'react'

import { useCreateAgentProfile, useUpdateAgentProfile } from '@/api/queries'
import type { AgentProfile, FsBrowseDir, ProviderId } from '@open-mercato/cezar-api-client'
import { FolderBrowser } from '@/components/folder-browser'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/toaster'

/**
 * "Add agent account" (spec 2026-07-29-agent-profiles): point a provider at a second config
 * folder, so a work login can sit beside a personal one.
 *
 * **The typed path is the source of truth, not the browser selection.** Two reasons, and both are
 * disqualifying for a browse-only picker:
 *
 * 1. every candidate is a dotfolder (`~/.claude-second`), and a folder that does not exist yet
 *    cannot be browsed to at all — yet that is the normal case, because the documented flow is
 *    *add the account → Connect → the CLI creates the folder on login*;
 * 2. `GET /api/v1/fs/browse` is refused in single-project mode and is rooted at the configured
 *    browse root, so a browse-only field would make the whole feature unreachable for anyone
 *    whose accounts live outside it.
 *
 * The browser is therefore an assist that fills the field, and it asks for hidden folders because
 * otherwise it could not show a single real candidate. cezar still does not go LOOKING for
 * accounts — see the spec's "no globbing": a folder is an account because the user said so.
 *
 * Validation stays server-side (absolute after `~` expansion, not already another account's
 * folder, no control characters); this dialog only refuses an empty field, because that is not a
 * request worth sending.
 *
 * ## The `http` provider is not a folder at all
 *
 * Every CLI account is a HOME — a directory an env var relocates. `http` is an HTTP endpoint, so
 * its "config dir" IS its configuration: the `{endpoint, apiKey, model}` JSON that
 * `CEZ_HTTP_AGENT_CONFIG` carries. Asking for a folder there produced an account the runner could
 * never parse, so this dialog asks for the three fields instead, in a `provider === 'http'` branch
 * that covers both the create and the edit case.
 *
 * That branch is also why the dialog takes an `account` to edit. A path-shaped account is edited by
 * pointing it at a different folder — a thing nobody does, and which the row's Rename/Remove
 * already covers by remove-and-re-add. An endpoint account is edited constantly (which model, which
 * key), and there is nowhere else in the UI to do it.
 *
 * The API-key field is seeded with the server's MASK, and posting that mask back unchanged is how
 * the key survives an edit — the server restores the stored secret from it
 * (`mergeHttpAccountSecret`). One spelling of that sentinel, in the contract.
 */
type HttpFields = { endpoint: string; apiKey: string; model: string }

/** Read an http account's JSON back into the three fields the form shows. A value that is not
 *  JSON yet (a half-typed edit from an older API client) yields empty fields, never a throw. */
export function parseHttpFields(configDir: string): HttpFields {
  try {
    const parsed = JSON.parse(configDir) as Record<string, unknown>
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const text = (value: unknown) => (typeof value === 'string' ? value : '')
      return {
        endpoint: text(parsed.endpoint),
        apiKey: text(parsed.apiKey),
        model: text(parsed.model),
      }
    }
  } catch {
    // Not JSON — the field was left empty or is mid-edit.
  }
  return { endpoint: '', apiKey: '', model: '' }
}

/** The inverse: only the keys the user actually filled, so an account with no key does not store
 *  `"apiKey": ""` — which the row would then render as a credential that exists. */
export function httpConfigDir(fields: HttpFields): string {
  return JSON.stringify({
    endpoint: fields.endpoint.trim(),
    ...(fields.apiKey.trim() ? { apiKey: fields.apiKey.trim() } : {}),
    ...(fields.model.trim() ? { model: fields.model.trim() } : {}),
  })
}

export function AddAccountDialog({
  open,
  onOpenChange,
  providers,
  initialProvider,
  account,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Providers that can carry more than one account — the server decides, not this dialog. */
  providers: ProviderId[]
  /** Which agent's "Add account" was clicked; still switchable in the dialog. */
  initialProvider?: ProviderId
  /** Set to EDIT this account instead of adding one. Its provider is then fixed: the update route
   *  names an account id, and nothing else, so a provider change is not a thing it can express. */
  account?: AgentProfile
}) {
  // `null` = the configured browse root. The dialog never spells that path itself.
  const [path, setPath] = useState<string | null>(null)
  const [selected, setSelected] = useState<FsBrowseDir | null>(null)
  const [provider, setProvider] = useState<ProviderId>(
    account?.provider ?? initialProvider ?? providers[0] ?? 'claude',
  )
  const [label, setLabel] = useState(account?.label ?? '')
  const [configDir, setConfigDir] = useState('')
  const [http, setHttp] = useState<HttpFields>(() =>
    account?.provider === 'http' ? parseHttpFields(account.configDir) : { endpoint: '', apiKey: '', model: '' },
  )
  const [browsing, setBrowsing] = useState(false)
  const create = useCreateAgentProfile()
  const update = useUpdateAgentProfile()
  const pending = create.isPending || update.isPending

  const isHttp = provider === 'http'
  const editing = account !== undefined
  const trimmed = configDir.trim()
  // The local gate, and the only one: everything else is the server's answer, which this dialog
  // cannot infer. An http account is complete when it names an endpoint.
  const incomplete = isHttp ? http.endpoint.trim() === '' : trimmed === ''

  const reset = () => create.reset()

  const enter = (dir: string) => {
    setPath(dir)
    setSelected(null)
    reset() // a stale "already used by …" must not haunt the next folder
  }

  /** Browsing writes into the field; the field is what gets submitted. */
  const take = (dir: FsBrowseDir) => {
    setSelected(dir)
    setConfigDir(dir.path)
    reset()
  }

  const submit = () => {
    if (incomplete || pending) return
    const nextConfigDir = isHttp ? httpConfigDir(http) : trimmed
    const name = label.trim()
    const done = (message: string) => {
      onOpenChange(false)
      toast(message)
    }
    if (editing) {
      // `label` is always sent here, unlike create: an edit that clears the name must clear it on
      // the server too, and only an explicit value can say that.
      update.mutate(
        { id: account.id, label: name || account.id, configDir: nextConfigDir },
        { onSuccess: () => done(`Updated ${name || account.label}`) },
      )
      return
    }
    create.mutate(
      { provider, configDir: nextConfigDir, ...(name ? { label: name } : {}) },
      {
        onSuccess: () =>
          done(
            isHttp
              ? 'HTTP account added — cezar will use it for tasks on this agent.'
              : 'Account added — use Connect to sign in',
          ),
      },
    )
  }

  const error = create.error ?? update.error

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="add-account-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit agent account' : 'Add agent account'}</DialogTitle>
          <DialogDescription>
            {isHttp
              ? 'The endpoint this account talks to, and the credential it sends. cezar loads it into the run as CEZ_HTTP_AGENT_CONFIG.'
              : editing
                ? 'Rename this account, or point it at a different config folder.'
                : 'The config folder this account uses. It does not have to exist yet — Connect signs in and the CLI creates it.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">Agent</span>
            <select
              aria-label="Agent"
              data-slot="add-account-provider"
              value={provider}
              disabled={editing}
              onChange={(event) => {
                const next = event.target.value as ProviderId
                setProvider(next)
                setBrowsing(false)
                reset()
              }}
              className="rounded-md border border-input bg-card px-2 py-1 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
            >
              {providers.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
            <span className="shrink-0 text-muted-foreground">Name</span>
            <input
              type="text"
              aria-label="Account name"
              data-slot="add-account-label"
              value={label}
              placeholder="Work"
              onChange={(event) => setLabel(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-input bg-card px-2 py-1 text-[13px] outline-none focus-visible:border-ring"
            />
          </label>
        </div>

        {isHttp ? (
          <div className="flex flex-col gap-2">
            <label className="flex min-w-0 items-center gap-2 text-[13px]">
              <span className="w-20 shrink-0 text-muted-foreground">Endpoint</span>
              <input
                type="url"
                spellCheck={false}
                autoComplete="off"
                aria-label="Endpoint URL"
                data-slot="add-account-endpoint"
                value={http.endpoint}
                placeholder="https://api.example.com/v1/chat/completions"
                onChange={(event) => {
                  setHttp((fields) => ({ ...fields, endpoint: event.target.value }))
                  reset()
                }}
                className="min-w-0 flex-1 rounded-md border border-input bg-card px-2 py-1 font-mono text-[12.5px] outline-none focus-visible:border-ring"
              />
            </label>
            <label className="flex min-w-0 items-center gap-2 text-[13px]">
              <span className="w-20 shrink-0 text-muted-foreground">API key</span>
              <input
                type="text"
                spellCheck={false}
                autoComplete="off"
                aria-label="API key"
                data-slot="add-account-api-key"
                value={http.apiKey}
                placeholder="optional — only if the endpoint requires one"
                onChange={(event) => {
                  setHttp((fields) => ({ ...fields, apiKey: event.target.value }))
                  reset()
                }}
                className="min-w-0 flex-1 rounded-md border border-input bg-card px-2 py-1 font-mono text-[12.5px] outline-none focus-visible:border-ring"
              />
            </label>
            <label className="flex min-w-0 items-center gap-2 text-[13px]">
              <span className="w-20 shrink-0 text-muted-foreground">Model</span>
              <input
                type="text"
                spellCheck={false}
                autoComplete="off"
                aria-label="Model"
                data-slot="add-account-model"
                value={http.model}
                placeholder="optional — the endpoint's default when blank"
                onChange={(event) => {
                  setHttp((fields) => ({ ...fields, model: event.target.value }))
                  reset()
                }}
                className="min-w-0 flex-1 rounded-md border border-input bg-card px-2 py-1 font-mono text-[12.5px] outline-none focus-visible:border-ring"
              />
            </label>
            <p className="text-[11.5px] text-soft-foreground">
              Stored in <code>~/.cezar/agent-accounts.json</code>; the key is never sent back to
              this page — cezar masks it, and leaving the mask alone keeps the saved one.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label className="flex min-w-0 items-center gap-2 text-[13px]">
              <span className="shrink-0 text-muted-foreground">Folder</span>
              <input
                type="text"
                spellCheck={false}
                autoComplete="off"
                aria-label="Config folder"
                data-slot="add-account-dir"
                value={configDir}
                placeholder={provider === 'codex' ? '~/.codex-second' : '~/.claude-second'}
                onChange={(event) => {
                  setConfigDir(event.target.value)
                  setSelected(null)
                  reset()
                }}
                className="min-w-0 flex-1 rounded-md border border-input bg-card px-2 py-1 font-mono text-[12.5px] outline-none focus-visible:border-ring"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-action="add-account-browse"
                aria-expanded={browsing}
                onClick={() => setBrowsing((on) => !on)}
              >
                {browsing ? 'Hide folders' : 'Browse…'}
              </Button>
            </label>
            <p className="text-[11.5px] text-soft-foreground">
              A <code>~</code> is kept as written and expanded when the agent runs.
            </p>
          </div>
        )}

        {/* Collapsed by default: typing (or pasting) the path is the fast path, and browsing to a
            folder that does not exist yet is impossible anyway. */}
        {browsing && !isHttp ? (
          <FolderBrowser
            path={path}
            selected={selected}
            onSelect={take}
            onEnter={enter}
            // Every agent config folder is hidden — without this the listing shows none of them.
            showHidden
            emptyHint="No subfolders here — pick this folder by typing its path above."
          />
        ) : null}

        {/* The server's own words: "that is already this agent's default folder", "already used
            by …", "must be an absolute path". This dialog cannot know which applies. */}
        {error ? (
          <p data-slot="add-account-error" className="min-w-0 break-words text-[13px] text-danger">
            {error instanceof Error ? error.message : 'could not save that account'}
          </p>
        ) : null}

        <DialogFooter className="min-w-0 sm:items-center sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-slot="add-account-confirm"
            disabled={incomplete || pending}
            onClick={submit}
          >
            {pending ? 'Saving…' : editing ? 'Save changes' : 'Add account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
