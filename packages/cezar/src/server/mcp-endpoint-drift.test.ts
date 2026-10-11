import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENDPOINTS, fillPath, PROJECT, PROJECT_PARAM } from '@open-mercato/cezar-mcp-server/endpoints';
import { RunStore } from '../runs/store.ts';
import type { RunManager } from '../workflows/run.ts';
import { createApp } from './server.ts';

/**
 * The MCP server's endpoint table drift guard.
 *
 * `packages/mcp-server` spells every cezar URL it calls in ONE table (`src/endpoints.ts`) so this
 * test can assert each of them against a BUILT app's route table. Before that table existed the
 * URLs were spelled inline in each tool handler and nothing tied them to the routes the service
 * registers. They drifted, silently and for a long time: by 2026-10-11 more than twenty tools
 * pointed at paths that had been removed or renamed (`GET /workflows/:name`, `PUT /skills/:name`,
 * `PATCH /automations/:id`, `GET /dashboard/costs`, `GET /git/branches`, `GET /repo/info`,
 * `GET /projects/:id`, …) and several more sent a body or query the route rejects
 * (`dispatch: { enabled: true }`, `continue: { message }`, `?type=&number=` on `/github/ref-status`).
 * Nothing failed loudly — an MCP client just got a `404`/`400` back and rendered it as the tool's
 * RESULT, so a broken tool looked like a tool that had answered.
 *
 * Like `bc-route-inventory.test.ts`, this reads the registered side off a **built app**
 * (`app.routes`) rather than off server.ts's source: a chained family builder has no `app.get(…)`
 * statement for a regex to find, so a source scan would quietly stop seeing routes — the one
 * failure mode a drift guard must not have.
 *
 * SCOPE LIMIT worth knowing: this compares PATHS AND METHODS, not request bodies. A tool that
 * posts `{ message }` where the route wants `{ text }` is invisible here; that class is caught by
 * reading the route's zod schema (see `validators.ts` and the contract package).
 */

const REPO_ROOT = join(import.meta.dirname, '../../../..');

/** `{projectId}`, `:runId`, `:id` … all become one placeholder, so the two sides' naming choices
 *  can differ without the guard caring. The MCP table's names are internal; only the shape is
 *  the contract. */
function normalizePath(path: string): string {
  return path
    .replace(/\{[A-Za-z0-9_]+\}/g, ':p')
    .replace(/:[A-Za-z0-9_]+/g, ':p')
    .replace(/\/+$/, '');
}

// A real app, because the route table is what is being checked. The deps are the minimum
// `createApp` needs to build one: no run starts here, nothing is requested — the app is only
// asked what routes it has.
const repoRoot = mkdtempSync(join(tmpdir(), 'cez-mcp-endpoints-'));
const app = createApp({
  repoRoot,
  store: RunStore.open(join(repoRoot, '.ai/cezar')),
  manager: {} as RunManager,
  version: '0.0.0-test',
});

/** Every `METHOD /path` a built app answers on, both the unscoped and the `/p/:projectId` mirror
 *  spelling, normalized. `method: 'ALL'` is middleware (`app.use`), not a callable route. */
const registeredRoutes = new Set(
  app.routes
    .filter((route) => route.method !== 'ALL')
    .map((route) => `${route.method} ${normalizePath(route.path)}`),
);

/** Every `METHOD /path` the MCP table calls, normalized the same way. */
const mcpRoutes = new Map(
  Object.entries(ENDPOINTS).map(([key, endpoint]) => [
    key,
    `${endpoint.method} ${normalizePath(endpoint.path)}`,
  ]),
);

describe('MCP endpoint table vs the routes cezar registers', () => {
  it('names only routes a built app actually answers', () => {
    const missing = [...mcpRoutes].filter(([, route]) => !registeredRoutes.has(route)).map(([key, route]) => `${key}: ${route}`);

    expect(
      missing,
      'These entries in packages/mcp-server/src/endpoints.ts point at routes no built app ' +
        'registers, so the MCP tool behind each one can only ever answer 404. Either the route ' +
        'was renamed or removed (repoint the entry, or drop the tool if the surface is gone), or ' +
        'the entry is new and the route it assumes was never chained into a family builder.',
    ).toEqual([]);
  });

  it('compares a non-trivial number of routes on both sides — guards against a vacuous pass', () => {
    // Without this, a reader that silently stopped seeing routes would make the guard above pass
    // by comparing two empty sets, which is exactly the failure mode a drift guard must not have.
    expect(registeredRoutes.size).toBeGreaterThan(100);
    expect(mcpRoutes.size).toBeGreaterThan(40);
  });

  it('keeps every endpoint under the versioned /api/v1 surface', () => {
    const unversioned = [...mcpRoutes].filter(([, route]) => !route.includes(' /api/v1/')).map(([key]) => key);
    expect(unversioned).toEqual([]);
  });

  it('reaches a project-scoped route through /p/:projectId, never a bare path', () => {
    // The unscoped spelling is bound to the BOOT project. An MCP server that carries its own
    // `CEZ_PROJECT_ID` must name the project it means, or a tool silently answers about whatever
    // project the cockpit happened to boot in.
    const unscoped = [...mcpRoutes]
      .filter(([, route]) => !route.includes('/api/v1/p/'))
      .map(([key, route]) => `${key}: ${route}`);
    // The workspace-level families are the deliberate exception: they answer for every project
    // and have no scoped spelling at all. So are the project-REGISTRY routes, which name a
    // project in their path for a different reason — they manage the registry itself.
    expect(unscoped.sort()).toEqual(
      [
        'addProject: POST /api/v1/projects',
        'agentConfig: GET /api/v1/agent-config',
        'agentProfiles: GET /api/v1/workspace/agent-profiles',
        'dashboard: GET /api/v1/workspace/dashboard',
        'dashboardCosts: GET /api/v1/workspace/dashboard/costs',
        'dashboardInsights: GET /api/v1/workspace/dashboard/insights',
        'dashboardOverview: GET /api/v1/workspace/dashboard/overview',
        'health: GET /api/v1/health',
        'models: GET /api/v1/models',
        'projects: GET /api/v1/projects',
        'removeProject: DELETE /api/v1/projects/:p',
        'runsIndex: GET /api/v1/workspace/runs-index',
        'updateProject: PATCH /api/v1/projects/:p',
      ].sort(),
    );
  });

  it('is referenced by the server it exists for — a dead entry is drift too', () => {
    // The table only earns its keep if the server reads it. A key nothing calls is either a tool
    // that was dropped without its endpoint, or a typo in the handler's reference (which the
    // compiler catches) — either way it should not stay.
    const source = readFileSync(join(REPO_ROOT, 'packages/mcp-server/src/index.ts'), 'utf8');
    const referenced = new Set([...source.matchAll(/\bENDPOINTS\.([A-Za-z0-9_]+)\b/g)].map((m) => m[1]!));
    const unused = Object.keys(ENDPOINTS).filter((key) => !referenced.has(key));
    expect(unused).toEqual([]);
  });
});

describe('fillPath', () => {
  it('substitutes a named placeholder', () => {
    expect(fillPath('/api/v1/p/{projectId}/runs/{runId}', { projectId: 'default', runId: 'abc' })).toBe(
      '/api/v1/p/default/runs/abc',
    );
  });

  it('encodes the value, so an id with a slash cannot escape its segment', () => {
    expect(fillPath('/api/v1/p/{projectId}/tracker/{id}', { projectId: 'default', id: 'a/b' })).toBe(
      '/api/v1/p/default/tracker/a%2Fb',
    );
  });

  it('throws on a missing placeholder rather than sending a literal brace', () => {
    // A literal `{runId}` in a URL is a 404 the caller cannot diagnose; a throw names the bug.
    expect(() => fillPath('/api/v1/runs/{runId}', {})).toThrow('missing path parameter: runId');
  });

  it('leaves a template with no placeholders alone', () => {
    expect(fillPath('/api/v1/health')).toBe('/api/v1/health');
  });

  it('uses the exported param name, so callers never re-spell it', () => {
    // `PROJECT` is built FROM `PROJECT_PARAM`, which is what lets `buildUrl` fill the placeholder
    // by name instead of slicing the braces off the string.
    expect(PROJECT).toBe(`{${PROJECT_PARAM}}`);
    expect(fillPath(PROJECT, { [PROJECT_PARAM]: 'default' })).toBe('default');
  });
});
