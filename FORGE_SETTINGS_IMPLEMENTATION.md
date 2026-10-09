# Implementation Progress: Forge Settings UI

## ✅ Completed

### Phase 1: Contract & Types
- ✅ Created `packages/contract/src/forges.ts` with all schemas
- ✅ Exported from `packages/contract/src/index.ts`
- ✅ Types: `ForgeKind`, `ForgeStatus`, `ForgesStatusResponse`, `ForgeConnectInput`, `ForgeConnectResponse`

### Phase 2: Server Service
- ✅ Created `packages/cezar/src/server/forge-status.ts`
- ✅ Function `getForgesStatus()` - checks all 4 forge CLIs in parallel
- ✅ Function `buildForgeAuthCommand()` - builds auth commands with host support
- ✅ CLI detection with version, auth status, username, host parsing

## 🚧 Remaining Work

### Phase 3: Server API Routes (30 mins)
**File:** `packages/cezar/src/server/server.ts`

**Location:** After line 2088 (after providersRoutes definition)

**Add:**
```typescript
import { getForgesStatus, buildForgeAuthCommand } from './forge-status.ts';
import { forgeKindSchema, forgeConnectInputSchema } from '@open-mercato/cezar-contract';

// Around line 2089, after providersRoutes
const forgesRoutes = new Hono<ProjectApiEnv>()
  .get(
    '/forges/status',
    queryZodValidator(z.object({ refresh: queryValue.refine((v) => v === undefined || v === '1') })),
    async (c) => {
      const query = c.req.valid('query');
      return c.json(await getForgesStatus({ refresh: query.refresh === '1' }));
    },
  )
  
  .post(
    '/forges/:kind/connect',
    paramZodValidator(z.object({ kind: forgeKindSchema })),
    jsonZodValidator(forgeConnectInputSchema),
    async (c) => {
      const { kind } = c.req.valid('param');
      const { host } = c.req.valid('json');
      
      const command = buildForgeAuthCommand(kind, host);
      
      // For now, just return the command for manual execution
      // Future: could try to open terminal automatically
      return c.json({
        opened: false,
        authenticated: false,
        command,
      });
    },
  );

// Mount routes (find line with: api = api.route('/providers', providersRoutes))
// Add after it:
api = api.route('/forges', forgesRoutes);

// Also mount on project-scoped routes (find: projectApi = projectApi.route('/providers', providersRoutes))
// Add after it:
projectApi = projectApi.route('/forges', forgesRoutes);
```

### Phase 4: API Client (20 mins)
**File:** `packages/api-client/src/client.ts`

**Add functions:**
```typescript
import type { ForgeKind, ForgeConnectInput, ForgesStatusResponse, ForgeConnectResponse } from '@open-mercato/cezar-contract';

export async function getForgesStatus(opts?: { refresh?: boolean }): Promise<ForgesStatusResponse> {
  const query = opts?.refresh ? '?refresh=1' : '';
  const response = await fetch(`${getApiBase()}/forges/status${query}`);
  if (!response.ok) throw new ApiError('Failed to fetch forges status', response.status);
  return response.json();
}

export async function connectForge(
  kind: ForgeKind,
  input: ForgeConnectInput,
): Promise<ForgeConnectResponse> {
  const response = await fetch(`${getApiBase()}/forges/${kind}/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new ApiError('Failed to connect forge', response.status);
  return response.json();
}
```

### Phase 5: Web UI Component (2 hours)
**File:** `packages/web/src/routes/settings/forges-section.tsx` (NEW)

**Implementation:** See `.ai/plans/2026-10-07-forge-settings-ui.md` Phase 4 for complete code

**Key features:**
- Cards for GitHub, GitLab, Gitea, Forgejo
- Status dots (connected/pending/offline)
- Username display when authenticated
- Connect button with command
- Self-hosted setup collapsible section
- Docs links

### Phase 6: Register Section (5 mins)
**File:** `packages/web/src/routes/settings/registry.tsx`

**Add import:**
```typescript
import { GitBranchIcon } from 'lucide-react';
import { ForgesSection } from './forges-section';
```

**Add to SETTINGS_SECTIONS array (around line 180, in global scope):**
```typescript
{
  id: 'forges',
  title: 'Forges',
  description: 'GitHub, GitLab, Gitea, and Forgejo.',
  icon: GitBranchIcon,
  component: ForgesSection,
  scope: 'global',
},
```

### Phase 7: Tests (2 hours)
**Files to create:**
1. `packages/cezar/src/server/forge-status.test.ts`
2. `packages/web/src/routes/settings/forges-section.test.tsx`
3. `packages/contract/src/forges.test.ts`

### Phase 8: Documentation (30 mins)
**Files to update:**
1. `docs/multi-forge-support.md` - Add "Configuration via Settings" section
2. `BACKWARD_COMPATIBILITY.md` - Document `/forges/status` and `/forges/:kind/connect` routes
3. `README.md` - Mention forge configuration in Settings

## 📝 Quick Start Commands

```bash
# Build and test
npm run typecheck
npm test
npm run build

# Start dev server
npm run dev

# Navigate to Settings
# http://localhost:4321/settings/global
# → Should see new "Forges" section
```

## 🎯 Success Checklist

- [ ] `/api/v1/forges/status` returns status for all 4 forges
- [ ] `/api/v1/forges/:kind/connect` returns auth command
- [ ] Settings UI shows forge cards
- [ ] Status dots reflect authentication state
- [ ] Connect button shows command in UI
- [ ] Self-hosted input works for GitLab/Gitea/Forgejo
- [ ] All tests pass
- [ ] Documentation updated

## 📚 Reference Files

- **Plan:** `.ai/plans/2026-10-07-forge-settings-ui.md`
- **Contract:** `packages/contract/src/forges.ts`
- **Service:** `packages/cezar/src/server/forge-status.ts`
- **Pattern:** `packages/web/src/routes/settings/provider-settings.tsx` (reference for UI)

## ⏱️ Estimated Remaining Time

- Server routes: 30 mins
- API client: 20 mins
- UI component: 2 hours
- Registration: 5 mins
- Tests: 2 hours
- Documentation: 30 mins

**Total: ~5.5 hours**

---

*Progress saved: 2026-10-07*
*Next step: Add forges routes to server.ts*
