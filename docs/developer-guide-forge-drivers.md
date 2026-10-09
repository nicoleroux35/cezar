# Developer Guide: Enhanced Forge Drivers

This guide is for developers who want to integrate, extend, or maintain the enhanced forge drivers.

## Architecture Overview

### Driver Hierarchy

```
ForgeDriver (interface)
├── GitHub Driver (github.ts) - Reference implementation
├── GitLab Enhanced (gitlab-enhanced.ts) - NEW
├── Gitea Enhanced (gitea-enhanced.ts) - NEW
└── Forgejo (uses gitea-enhanced.ts) - NEW
```

### Key Principles

1. **Optional Methods** - All new methods are optional on `ForgeDriver`
2. **Graceful Degradation** - Every failure returns `{ available: false, reason }`
3. **Type Safety** - Zod validation at API boundaries
4. **Caching** - Three-layer cache (list, merge state, diff)
5. **Dry-Run Support** - All operations work without real CLI

## Integration Steps

### Step 1: Replace Old Drivers

Update `packages/cezar/src/server/forge/index.ts`:

```typescript
// OLD
import { createGitlabDriver } from './gitlab.ts';
import { createGiteaDriver } from './gitea.ts';

// NEW
import { createEnhancedGitlabDriver } from './gitlab-enhanced.ts';
import { createEnhancedGiteaDriver, createEnhancedForgejoDriver } from './gitea-enhanced.ts';

export function resolveForge(repoRoot: string, remoteUrl: string): ForgeDriver {
  const parsed = parseGitRemote(remoteUrl);
  
  if (!parsed) {
    return createGithubDriver(repoRoot, null);
  }
  
  const { host, owner, repo } = parsed;
  
  // Detect forge kind
  if (isGitHub(host)) {
    return createGithubDriver(repoRoot, { host, owner, repo });
  } else if (isGitLab(host)) {
    return createEnhancedGitlabDriver(repoRoot, { host, owner, repo });
  } else if (isGitea(host)) {
    return createEnhancedGiteaDriver(repoRoot, { host, owner, repo });
  } else if (isForgejo(host)) {
    return createEnhancedForgejoDriver(repoRoot, { host, owner, repo });
  }
  
  // Default to GitHub
  return createGithubDriver(repoRoot, { host, owner, repo });
}
```

### Step 2: Add Route Handlers

Update `packages/cezar/src/server/server.ts` to expose new methods:

```typescript
// Merge state endpoint
forgeRoutes.get('/pr/:number/merge-state', async (c) => {
  const projectId = c.req.param('projectId');
  const number = Number(c.req.param('number'));
  
  const driver = await getForgeDriver(projectId);
  
  if (!driver.prMergeState) {
    return c.json({ available: false, reason: 'Merge state not supported by this forge' });
  }
  
  const result = await driver.prMergeState(number);
  return c.json(result);
});

// Merge endpoint
forgeRoutes.post('/pr/:number/merge', async (c) => {
  const projectId = c.req.param('projectId');
  const number = Number(c.req.param('number'));
  const body = await c.req.json();
  
  const driver = await getForgeDriver(projectId);
  
  if (!driver.mergePR) {
    return c.json({ merged: false, status: 502, error: 'Merging not supported by this forge' }, 502);
  }
  
  const result = await driver.mergePR(number, body);
  
  if (result.merged) {
    return c.json(result);
  } else {
    return c.json(result, result.status);
  }
});

// Diff endpoint
forgeRoutes.get('/pr/:number/diff', async (c) => {
  const projectId = c.req.param('projectId');
  const number = Number(c.req.param('number'));
  
  const driver = await getForgeDriver(projectId);
  
  if (!driver.prDiff) {
    return c.json({ available: false, reason: 'PR diffs not supported by this forge' });
  }
  
  const result = await driver.prDiff(number);
  return c.json(result);
});
```

### Step 3: Update Contract Schemas

Add schemas to `packages/contract/src/forge.ts`:

```typescript
import { z } from 'zod';

export const forgeMergeMethodSchema = z.enum(['merge', 'squash', 'rebase']);

export const forgePrCheckSchema = z.object({
  name: z.string(),
  state: z.enum(['passing', 'failing', 'pending', 'unknown']),
  required: z.boolean().nullable(),
  url: z.string().optional(),
});

export const forgePrMergeStateSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.enum(['open', 'closed', 'merged']),
  isDraft: z.boolean(),
  headRef: z.string(),
  baseRef: z.string(),
  headSha: z.string(),
  mergeable: z.enum(['mergeable', 'conflicting', 'unknown']),
  reviewDecision: z.enum(['approved', 'changes-requested', 'review-required', 'unknown']),
  checks: z.array(forgePrCheckSchema),
  checksTier: z.enum(['detailed', 'aggregate', 'none']),
  checksReason: z.string().optional(),
  methods: z.array(forgeMergeMethodSchema),
  defaultMethod: forgeMergeMethodSchema.nullable(),
  eligibility: z.enum(['ready', 'blocked', 'pending', 'unauthorized', 'terminal', 'unknown']),
  blockers: z.array(z.object({
    code: z.string(),
    message: z.string(),
  })),
  canMerge: z.boolean(),
  canOverride: z.boolean(),
});

export const forgeMergeInputSchema = z.object({
  method: forgeMergeMethodSchema,
  expectedHeadSha: z.string(),
  overrideRules: z.boolean().optional(),
});

export const forgeMergeResultSchema = z.discriminatedUnion('merged', [
  z.object({
    merged: z.literal(true),
    number: z.number(),
    url: z.string(),
    method: forgeMergeMethodSchema,
    mergeCommitSha: z.string().optional(),
  }),
  z.object({
    merged: z.literal(false),
    status: z.union([z.literal(403), z.literal(404), z.literal(409), z.literal(502)]),
    error: z.string(),
    code: z.string().optional(),
    current: forgePrMergeStateSchema.optional(),
  }),
]);

export const forgePrChangeSchema = z.object({
  path: z.string(),
  previousPath: z.string().optional(),
  status: z.enum(['added', 'modified', 'removed', 'renamed', 'copied', 'changed']),
  additions: z.number(),
  deletions: z.number(),
  patch: z.string().optional(),
  patchUnavailableReason: z.enum(['binary', 'too-large', 'not-provided']).optional(),
  truncated: z.boolean().optional(),
});

export const forgePrDiffResultSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(true),
    number: z.number(),
    headSha: z.string(),
    files: z.array(forgePrChangeSchema),
    additions: z.number(),
    deletions: z.number(),
    truncated: z.boolean(),
    reason: z.string().optional(),
  }),
  z.object({
    available: z.literal(false),
    reason: z.string(),
  }),
]);
```

### Step 4: Update UI Components

Add merge UI in `packages/web/src/routes/pr-detail.tsx`:

```typescript
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

export function PrMergePanel({ prNumber }: { prNumber: number }) {
  const [selectedMethod, setSelectedMethod] = useState<'merge' | 'squash' | 'rebase'>('squash');
  
  // Fetch merge state
  const { data: mergeState, refetch } = useQuery({
    queryKey: ['pr-merge-state', prNumber],
    queryFn: async () => {
      const res = await fetch(`/api/v1/forge/pr/${prNumber}/merge-state`);
      return res.json();
    },
    refetchInterval: 10_000, // Poll every 10s
  });
  
  // Merge mutation
  const mergeMutation = useMutation({
    mutationFn: async (method: 'merge' | 'squash' | 'rebase') => {
      const res = await fetch(`/api/v1/forge/pr/${prNumber}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method,
          expectedHeadSha: mergeState.mergeState.headSha,
        }),
      });
      return res.json();
    },
    onSuccess: () => {
      refetch();
    },
  });
  
  if (!mergeState?.available) {
    return <div>Merge state unavailable: {mergeState?.reason}</div>;
  }
  
  const { mergeState: state } = mergeState;
  
  return (
    <div className="merge-panel">
      <h3>Merge Pull Request</h3>
      
      {/* Eligibility status */}
      <div className={`status status-${state.eligibility}`}>
        {state.eligibility === 'ready' && '✅ Ready to merge'}
        {state.eligibility === 'blocked' && '⛔ Blocked'}
        {state.eligibility === 'pending' && '⏳ Pending'}
        {state.eligibility === 'terminal' && '🔒 Already merged or closed'}
      </div>
      
      {/* Blockers */}
      {state.blockers.length > 0 && (
        <div className="blockers">
          <h4>Merge is blocked by:</h4>
          <ul>
            {state.blockers.map((blocker, i) => (
              <li key={i}>{blocker.message}</li>
            ))}
          </ul>
        </div>
      )}
      
      {/* CI Checks */}
      {state.checks.length > 0 && (
        <div className="checks">
          <h4>Checks</h4>
          {state.checks.map((check, i) => (
            <div key={i} className={`check check-${check.state}`}>
              <span className="check-icon">
                {check.state === 'passing' && '✓'}
                {check.state === 'failing' && '✗'}
                {check.state === 'pending' && '○'}
              </span>
              <span className="check-name">{check.name}</span>
              {check.url && (
                <a href={check.url} target="_blank" rel="noopener">
                  Details
                </a>
              )}
            </div>
          ))}
        </div>
      )}
      
      {/* Merge controls */}
      {state.canMerge && (
        <div className="merge-controls">
          <select
            value={selectedMethod}
            onChange={(e) => setSelectedMethod(e.target.value as any)}
          >
            {state.methods.map((method) => (
              <option key={method} value={method}>
                {method === 'merge' && 'Create merge commit'}
                {method === 'squash' && 'Squash and merge'}
                {method === 'rebase' && 'Rebase and merge'}
              </option>
            ))}
          </select>
          
          <button
            onClick={() => mergeMutation.mutate(selectedMethod)}
            disabled={mergeMutation.isPending}
          >
            {mergeMutation.isPending ? 'Merging...' : 'Merge'}
          </button>
        </div>
      )}
      
      {/* Merge result */}
      {mergeMutation.data && (
        <div className={mergeMutation.data.merged ? 'success' : 'error'}>
          {mergeMutation.data.merged ? (
            <>
              ✅ Merged successfully!
              {mergeMutation.data.mergeCommitSha && (
                <code>{mergeMutation.data.mergeCommitSha.slice(0, 7)}</code>
              )}
            </>
          ) : (
            <>❌ Merge failed: {mergeMutation.data.error}</>
          )}
        </div>
      )}
    </div>
  );
}
```

## Testing

### Unit Tests

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createEnhancedGitlabDriver } from './gitlab-enhanced.ts';

describe('GitLab Enhanced Driver', () => {
  let driver: ForgeDriver;
  
  beforeEach(() => {
    process.env.CEZ_DRY_RUN = '1';
    driver = createEnhancedGitlabDriver('/test/repo', {
      host: 'gitlab.com',
      owner: 'test',
      repo: 'repo',
    });
  });
  
  describe('prMergeState', () => {
    it('returns merge state in dry-run mode', async () => {
      const result = await driver.prMergeState!(1);
      
      expect(result.available).toBe(true);
      if (result.available) {
        expect(result.mergeState.number).toBe(1);
        expect(result.mergeState.mergeable).toBe('mergeable');
        expect(result.mergeState.canMerge).toBe(true);
      }
    });
  });
  
  describe('mergePR', () => {
    it('succeeds in dry-run mode', async () => {
      const result = await driver.mergePR!(1, {
        method: 'squash',
        expectedHeadSha: '0123456789abcdef0123456789abcdef01234567',
      });
      
      expect(result.merged).toBe(true);
      if (result.merged) {
        expect(result.method).toBe('squash');
        expect(result.mergeCommitSha).toBeDefined();
      }
    });
  });
  
  describe('prDiff', () => {
    it('returns diff with files', async () => {
      const result = await driver.prDiff!(1);
      
      expect(result.available).toBe(true);
      if (result.available) {
        expect(result.files.length).toBeGreaterThan(0);
        expect(result.additions).toBeGreaterThan(0);
      }
    });
  });
});
```

### Integration Tests

```typescript
import { describe, it, expect } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

describe('GitLab Integration', () => {
  // Skip if glab not available
  const hasGlab = async () => {
    try {
      await execAsync('glab version');
      return true;
    } catch {
      return false;
    }
  };
  
  it.skipIf(!await hasGlab())('fetches real MR state', async () => {
    const driver = createEnhancedGitlabDriver(
      '/path/to/test/repo',
      { host: 'gitlab.com', owner: 'test', repo: 'repo' }
    );
    
    const result = await driver.prMergeState!(1);
    
    // Should get real data or graceful error
    expect(result).toBeDefined();
  });
});
```

## Maintenance

### Adding a New Forge

1. Create new driver file: `packages/cezar/src/server/forge/newforge.ts`
2. Implement `ForgeDriver` interface
3. Add to `resolveForge()` in `index.ts`
4. Add CLI detection logic
5. Create mock data for dry-run mode
6. Write comprehensive tests
7. Update documentation

### Updating API Schemas

When a forge changes its API:

1. Update zod schemas in driver file
2. Update type mappings
3. Add migration logic if needed
4. Test with real API responses
5. Update golden fixtures
6. Document breaking changes

### Performance Optimization

Monitor these metrics:

- **Cache hit rate** - Should be >60%
- **API call latency** - <3s for most operations
- **Error rate** - <1% in normal conditions

Optimization techniques:

- Increase cache duration for stable data
- Parallel API calls where possible
- Lazy loading of expensive data (CI checks)
- Request deduplication
- Pagination limits

## Troubleshooting

### Common Issues

**"CLI not found"**
- User hasn't installed CLI tool
- CLI not on PATH
- Check with `which glab` / `which tea`

**"Authentication failed"**
- CLI not authenticated
- Token expired
- Insufficient permissions
- Fix: `glab auth login` / `tea login add`

**"API rate limited"**
- Too many requests
- Need to wait or use token with higher limits
- Implement exponential backoff

**"Schema validation failed"**
- API response format changed
- Schema needs updating
- Log full response for diagnosis

## Best Practices

1. **Always validate at boundaries** - Use zod for all API responses
2. **Cache aggressively** - Network calls are expensive
3. **Degrade gracefully** - Never throw, return `{ available: false }`
4. **Test with dry-run** - All features must work offline
5. **Document everything** - Clear JSDoc for all public methods
6. **Handle edge cases** - Empty lists, missing fields, null values
7. **Respect rate limits** - Don't hammer the API
8. **Clear error messages** - Help users understand what went wrong

## Resources

- [ForgeDriver Interface](../packages/cezar/src/server/forge/types.ts)
- [GitHub Driver](../packages/cezar/src/server/forge/github.ts) - Reference
- [Implementation Spec](../.ai/specs/2026-10-07-high-priority-improvements.md)
- [Multi-Forge Support](multi-forge-support.md)
- [Merge Operations Guide](multi-forge-merge-operations.md)
