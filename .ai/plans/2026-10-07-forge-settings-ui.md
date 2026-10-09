# Forge Configuration in Settings UI

## Goal

Add a **Forges** section in `Settings → Global` to configure GitHub, GitLab, Gitea, and Forgejo, matching the existing Providers section's UX.

## Context

Currently, forges are configured only via CLI (`gh auth login`, `glab auth login`, `tea login add`). While this works with automatic detection, users have no visibility into forge status in the UI. This creates a UX inconsistency: agent providers have a dedicated Settings section, but forges don't.

## Approach

### Architecture: Mirror the Providers pattern

The existing Providers section (`provider-settings.tsx`) provides the blueprint:
1. **Contract:** Schemas for forge status, connect, enable/disable
2. **Server:** Routes for `/forges/status`, `/forges/:forge/connect`, `/forges/:forge/enabled`
3. **Backend:** Forge CLI detection and status checking
4. **UI:** React component rendering forge cards with status dots and action buttons

### Key differences from Providers

1. **Four forge types** vs. eight agent providers
2. **Per-forge CLI** (`gh`, `glab`, `tea`) vs. uniform provider pattern
3. **Project-scoped** (each repo has one forge) vs. workspace-global providers
4. **No enable/disable toggle** (forge is determined by git remote, not user choice)
5. **Self-hosted support** needed in UI (host configuration)

## Implementation Plan

### Phase 1: Contract & Types (packages/contract)

**Files to create:**
- `packages/contract/src/forges.ts` - New forge-specific schemas

**Schemas needed:**
```typescript
// Forge identity
export const forgeKindSchema = z.enum(['github', 'gitlab', 'gitea', 'forgejo']);
export type ForgeKind = z.infer<typeof forgeKindSchema>;

// Forge status (similar to providerStatusSchema)
export const forgeStatusSchema = z.object({
  kind: forgeKindSchema,
  available: z.boolean(),
  authenticated: z.boolean(),
  cli: z.string(), // 'gh', 'glab', 'tea'
  version: z.string().optional(),
  hint: z.string().optional(),
  user: z.string().optional(), // authenticated username
  host: z.string().optional(), // for self-hosted
});

// GET /api/v1/forges/status response
export const forgesStatusResponseSchema = z.object({
  forges: z.array(forgeStatusSchema),
});

// POST /api/v1/forges/:kind/connect request
export const forgeConnectInputSchema = z.object({
  host: z.string().optional(), // for self-hosted
});

// POST /api/v1/forges/:kind/connect response
export const forgeConnectResponseSchema = z.discriminatedUnion('opened', [
  z.object({ opened: z.literal(true), command: z.string() }),
  z.object({ opened: z.literal(false), authenticated: z.literal(true), command: z.string() }),
]);
```

**Export from index:**
```typescript
// packages/contract/src/index.ts
export * from './forges.ts';
```

### Phase 2: Server - Forge Status Service (packages/cezar/src/server)

**File to create:**
- `packages/cezar/src/server/forge-status.ts` - Forge CLI detection service

**Implementation:**
```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ForgeKind, ForgeStatus, ForgesStatusResponse } from '@open-mercato/cezar-contract';

const exec = promisify(execFile);

interface ForgeCliInfo {
  cli: string;
  versionFlag: string[];
  authCheckFlag: string[];
}

const FORGE_CLI_MAP: Record<ForgeKind, ForgeCliInfo> = {
  github: { cli: 'gh', versionFlag: ['--version'], authCheckFlag: ['auth', 'status'] },
  gitlab: { cli: 'glab', versionFlag: ['version'], authCheckFlag: ['auth', 'status'] },
  gitea: { cli: 'tea', versionFlag: ['--version'], authCheckFlag: ['login', 'list'] },
  forgejo: { cli: 'tea', versionFlag: ['--version'], authCheckFlag: ['login', 'list'] },
};

async function checkForgeCli(kind: ForgeKind): Promise<ForgeStatus> {
  const info = FORGE_CLI_MAP[kind];
  
  try {
    // Check if CLI is installed
    const { stdout: version } = await exec(info.cli, info.versionFlag, { timeout: 5000 });
    
    // Check authentication
    try {
      const { stdout: authOutput } = await exec(info.cli, info.authCheckFlag, { timeout: 5000 });
      
      // Parse authentication info
      const authenticated = !authOutput.includes('not logged in') && !authOutput.includes('not configured');
      const userMatch = authOutput.match(/Logged in to .+ as ([^\s]+)/i) || authOutput.match(/username: ([^\s]+)/i);
      const user = userMatch?.[1];
      const hostMatch = authOutput.match(/Logged in to ([^\s]+)/i) || authOutput.match(/host: ([^\s]+)/i);
      const host = hostMatch?.[1];
      
      return {
        kind,
        available: true,
        authenticated,
        cli: info.cli,
        version: version.trim().split('\n')[0],
        ...(user && { user }),
        ...(host && { host }),
      };
    } catch {
      // CLI exists but not authenticated
      return {
        kind,
        available: true,
        authenticated: false,
        cli: info.cli,
        version: version.trim().split('\n')[0],
        hint: `Run: ${info.cli} auth login`,
      };
    }
  } catch (err) {
    // CLI not installed
    const message = err instanceof Error ? err.message : String(err);
    const isNotFound = /ENOENT/.test(message);
    
    return {
      kind,
      available: false,
      authenticated: false,
      cli: info.cli,
      hint: isNotFound
        ? `${info.cli} CLI not installed`
        : `Error checking ${info.cli}: ${message.split('\n')[0]}`,
    };
  }
}

export async function getForgesStatus(opts?: { refresh?: boolean }): Promise<ForgesStatusResponse> {
  // Check all forges in parallel
  const statuses = await Promise.all(
    (['github', 'gitlab', 'gitea', 'forgejo'] as ForgeKind[]).map(checkForgeCli)
  );
  
  return { forges: statuses };
}
```

### Phase 3: Server - API Routes (packages/cezar/src/server/server.ts)

**Add forges routes family:**
```typescript
// In server.ts, after providersRoutes

const forgesRoutes = new Hono<ProjectApiEnv>()
  .get(
    '/forges/status',
    queryZodValidator(z.object({ refresh: queryValue.refine((v) => v === undefined || v === '1') })),
    async (c) => {
      const query = c.req.valid('query');
      return c.json(await getForgesStatus({ refresh: query.refresh === '1' }));
    }
  )
  
  .post(
    '/forges/:kind/connect',
    paramZodValidator(z.object({ kind: forgeKindSchema })),
    jsonZodValidator(forgeConnectInputSchema),
    async (c) => {
      const { kind } = c.req.valid('param');
      const { host } = c.req.valid('json');
      
      // Build auth command
      const commands: Record<ForgeKind, string> = {
        github: 'gh auth login',
        gitlab: host ? `glab auth login --hostname ${host}` : 'glab auth login',
        gitea: host ? `tea login add --url ${host}` : 'tea login add',
        forgejo: host ? `tea login add --url ${host}` : 'tea login add',
      };
      
      const command = commands[kind];
      
      // Try to open the command in user's terminal
      // (This is best-effort; may not work in all environments)
      try {
        // For now, just return the command for user to run
        // TODO: Implement actual terminal opening if needed
        return c.json({
          opened: false,
          authenticated: false,
          command,
        });
      } catch {
        return c.json({
          opened: false,
          authenticated: false,
          command,
        });
      }
    }
  );

// Mount the family
api = api.route('/forges', forgesRoutes);

// Add project-scoped aliases
projectApi = projectApi.route('/forges', forgesRoutes);
```

### Phase 4: Web UI - Forge Settings Component (packages/web)

**File to create:**
- `packages/web/src/routes/settings/forges-section.tsx`

**Implementation pattern (mirror provider-settings.tsx):**
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getForgesStatus, connectForge } from '@/api/client';
import { StatusDot } from '@/components/status-dot';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const FORGES = [
  { 
    kind: 'github' as const, 
    label: 'GitHub', 
    description: 'GitHub.com and GitHub Enterprise',
    docsUrl: 'https://cli.github.com',
  },
  { 
    kind: 'gitlab' as const, 
    label: 'GitLab', 
    description: 'GitLab.com and self-hosted GitLab',
    docsUrl: 'https://gitlab.com/gitlab-org/cli',
  },
  { 
    kind: 'gitea' as const, 
    label: 'Gitea', 
    description: 'Gitea.com and self-hosted Gitea',
    docsUrl: 'https://gitea.com/gitea/tea',
  },
  { 
    kind: 'forgejo' as const, 
    label: 'Forgejo', 
    description: 'Codeberg.org and self-hosted Forgejo',
    docsUrl: 'https://gitea.com/gitea/tea',
  },
];

export function ForgesSection() {
  const queryClient = useQueryClient();
  const { data: forgesStatus } = useQuery({
    queryKey: ['forges', 'status'],
    queryFn: () => getForgesStatus(),
    refetchInterval: 30_000,
  });

  const connectMutation = useMutation({
    mutationFn: ({ kind, host }: { kind: ForgeKind; host?: string }) =>
      connectForge(kind, { host }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forges', 'status'] });
    },
  });

  return (
    <section>
      <h2>Forges</h2>
      <p>Configure git forge integrations for issues, PRs, and draft PR creation.</p>
      
      <div className="space-y-4">
        {FORGES.map((forge) => {
          const status = forgesStatus?.forges.find((f) => f.kind === forge.kind);
          
          return (
            <div key={forge.kind} className="border rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{forge.label}</h3>
                    {status && (
                      <StatusDot
                        tone={
                          status.authenticated
                            ? 'success'
                            : status.available
                            ? 'pending'
                            : 'default'
                        }
                      />
                    )}
                    {status?.authenticated && status.user && (
                      <span className="text-sm text-muted-foreground">
                        @{status.user}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {forge.description}
                  </p>
                  
                  {status?.hint && (
                    <p className="text-sm text-yellow-600 mt-2">{status.hint}</p>
                  )}
                  
                  {status?.version && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {status.cli} {status.version}
                    </p>
                  )}
                </div>
                
                <div className="flex flex-col gap-2">
                  {!status?.authenticated && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => connectMutation.mutate({ kind: forge.kind })}
                    >
                      Connect
                    </Button>
                  )}
                  
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => window.open(forge.docsUrl, '_blank')}
                  >
                    Docs
                  </Button>
                </div>
              </div>
              
              {!status?.authenticated && forge.kind !== 'github' && (
                <details className="mt-3">
                  <summary className="text-sm cursor-pointer text-muted-foreground">
                    Self-hosted setup
                  </summary>
                  <div className="mt-2 space-y-2">
                    <Input
                      placeholder="https://gitlab.company.com"
                      className="text-sm"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const host = e.currentTarget.value;
                          if (host) connectMutation.mutate({ kind: forge.kind, host });
                        }
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Press Enter to connect to self-hosted instance
                    </p>
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

### Phase 5: Register in Settings (packages/web/src/routes/settings/registry.tsx)

**Add forges section:**
```typescript
import { GitBranchIcon } from 'lucide-react'; // Or appropriate icon
import { ForgesSection } from './forges-section';

export const SETTINGS_SECTIONS: SettingsSection[] = [
  // ... existing sections ...
  
  {
    id: 'forges',
    title: 'Forges',
    description: 'GitHub, GitLab, Gitea, and Forgejo.',
    icon: GitBranchIcon,
    component: ForgesSection,
    scope: 'global',
  },
  
  // ... rest of sections ...
];
```

### Phase 6: API Client (packages/api-client)

**Add forge endpoints:**
```typescript
// In packages/api-client/src/client.ts

export async function getForgesStatus(opts?: { refresh?: boolean }): Promise<ForgesStatusResponse> {
  const query = opts?.refresh ? '?refresh=1' : '';
  const response = await fetch(`${API_BASE}/forges/status${query}`);
  if (!response.ok) throw new ApiError('Failed to fetch forges status', response.status);
  return response.json();
}

export async function connectForge(
  kind: ForgeKind,
  input: ForgeConnectInput
): Promise<ForgeConnectResponse> {
  const response = await fetch(`${API_BASE}/forges/${kind}/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new ApiError('Failed to connect forge', response.status);
  return response.json();
}
```

### Phase 7: Tests

**Unit tests needed:**
1. `packages/cezar/src/server/forge-status.test.ts` - CLI detection logic
2. `packages/web/src/routes/settings/forges-section.test.tsx` - UI component
3. Contract validation in `packages/contract/src/forges.test.ts`

**Integration tests:**
1. `/forges/status` route returns correct shape
2. Connect flow with mocked CLI

## Non-Goals

- **NOT changing forge detection logic** - Git remote detection stays as-is
- **NOT adding forge enable/disable toggles** - Forge is determined by repo, not user preference
- **NOT implementing terminal opening** - Connect button shows command to run manually
- **NOT migrating existing CLI configs** - Users keep their existing `gh`/`glab`/`tea` setups
- **NOT adding forge-specific settings** - Keep it status-only, no per-forge configuration

## Risks & Mitigations

### Risk 1: CLI version compatibility
Different CLI versions may have different output formats.

**Mitigation:** Use stable commands (`gh auth status`, `glab auth status`) and regex patterns that work across versions. Test with multiple versions.

### Risk 2: Self-hosted detection complexity
Self-hosted instances have varied configurations.

**Mitigation:** Phase 1 keeps it simple - just show the command. Phase 2 (future) can add actual terminal opening.

### Risk 3: Performance of status checks
Checking 4 CLIs on every load could be slow.

**Mitigation:** 
- Cache results for 60s
- Only check on explicit refresh
- Run checks in parallel

### Risk 4: Confusion with existing forge detection
Users might think they need to configure forges here when auto-detection already works.

**Mitigation:** Add help text: "Forges are automatically detected from your git remote. This section shows authentication status."

## Documentation Updates

**Files to update:**
1. `docs/multi-forge-support.md` - Add section about Settings UI
2. `BACKWARD_COMPATIBILITY.md` - Document new `/forges/*` routes
3. `README.md` - Mention forge configuration in Settings

## Success Criteria

- [ ] Settings → Forges section exists and renders
- [ ] Shows correct status for all 4 forges (available/authenticated/not installed)
- [ ] Connect button shows command to run
- [ ] Self-hosted input field works for GitLab/Gitea/Forgejo
- [ ] Status updates when CLI is configured externally
- [ ] All tests pass
- [ ] Documentation updated

## Timeline Estimate

- Phase 1 (Contract): 1-2 hours
- Phase 2 (Server service): 2-3 hours
- Phase 3 (API routes): 1-2 hours
- Phase 4 (UI component): 3-4 hours
- Phase 5 (Registration): 30 mins
- Phase 6 (API client): 1 hour
- Phase 7 (Tests): 2-3 hours
- Documentation: 1 hour

**Total: 11-16 hours**

## Open Questions

1. Should Connect button try to open terminal automatically, or just show command?
   → **Decision needed from user**

2. Should we add a "Check again" button like Providers has?
   → **Recommendation: Yes, mirror Providers UX**

3. Should we show forge status on project Git tab too?
   → **Recommendation: Phase 2, focus on Settings first**
