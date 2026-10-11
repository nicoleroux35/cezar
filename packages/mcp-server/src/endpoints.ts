/**
 * Every cezar HTTP endpoint this MCP server calls — as DATA, so it can be checked.
 *
 * The server used to spell each URL inline, and nothing tied those spellings to the routes the
 * service actually registers. They drifted: by 2026-10-11 more than twenty tools pointed at
 * paths that no longer existed (`GET /workflows/:name`, `PUT /skills/:name`, `PATCH
 * /automations/:id`, `GET /dashboard/costs`, `GET /git/branches`, …) and several more sent a body
 * the route rejects. Nothing failed loudly — an MCP client just got `404`/`400` back as the
 * tool's "result".
 *
 * So the paths live here, in one table, and `packages/cezar/src/server/mcp-endpoint-drift.test.ts`
 * asserts every entry against a BUILT app's route table (`app.routes`). Adding a tool means adding
 * its endpoint here; the guard then fails on the commit that renames the route.
 *
 * `{projectId}`, `{runId}`, … are substituted at call time. Query strings are deliberately NOT
 * part of a path — the drift guard compares path templates, and the query is the caller's.
 */

export interface McpEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path template, always under `/api/v1`. */
  path: string;
}

/** The path-parameter name behind `PROJECT`. Exported so a caller fills it by NAME rather than
 *  re-spelling the string — `fillPath` throws on a name it was not given. */
export const PROJECT_PARAM = 'projectId';

/** Shorthand for the placeholder the caller substitutes with the target project id. */
export const PROJECT = `{${PROJECT_PARAM}}`;

export const ENDPOINTS = {
  // ---- tasks / runs -------------------------------------------------------
  listRuns: { method: 'GET', path: `/api/v1/p/${PROJECT}/runs` },
  startRun: { method: 'POST', path: `/api/v1/p/${PROJECT}/runs` },
  getRun: { method: 'GET', path: `/api/v1/p/${PROJECT}/runs/{runId}` },
  patchRun: { method: 'PATCH', path: `/api/v1/p/${PROJECT}/runs/{runId}` },
  deleteRun: { method: 'DELETE', path: `/api/v1/p/${PROJECT}/runs/{runId}` },
  archiveRun: { method: 'POST', path: `/api/v1/p/${PROJECT}/runs/{runId}/archive` },
  pinRun: { method: 'POST', path: `/api/v1/p/${PROJECT}/runs/{runId}/pin` },
  readRun: { method: 'POST', path: `/api/v1/p/${PROJECT}/runs/{runId}/read` },
  unreadRun: { method: 'POST', path: `/api/v1/p/${PROJECT}/runs/{runId}/unread` },
  archiveFinished: { method: 'POST', path: `/api/v1/p/${PROJECT}/runs/archive-finished` },
  readAll: { method: 'POST', path: `/api/v1/p/${PROJECT}/runs/read-all` },
  sendMessage: { method: 'POST', path: `/api/v1/p/${PROJECT}/runs/{runId}/messages` },
  cancelRun: { method: 'POST', path: `/api/v1/p/${PROJECT}/runs/{runId}/cancel` },
  finishRun: { method: 'POST', path: `/api/v1/p/${PROJECT}/runs/{runId}/finish` },
  continueRun: { method: 'POST', path: `/api/v1/p/${PROJECT}/runs/{runId}/continue` },
  cancelAutoResume: { method: 'DELETE', path: `/api/v1/p/${PROJECT}/runs/{runId}/auto-resume` },
  runDiff: { method: 'GET', path: `/api/v1/p/${PROJECT}/runs/{runId}/diff` },
  runCommits: { method: 'GET', path: `/api/v1/p/${PROJECT}/runs/{runId}/commits` },
  runChanges: { method: 'GET', path: `/api/v1/p/${PROJECT}/runs/{runId}/changes` },
  runGitCommit: { method: 'POST', path: `/api/v1/p/${PROJECT}/runs/{runId}/git/commit` },
  runGitPush: { method: 'POST', path: `/api/v1/p/${PROJECT}/runs/{runId}/git/push` },
  runPr: { method: 'POST', path: `/api/v1/p/${PROJECT}/runs/{runId}/pr` },
  removeWorktree: { method: 'POST', path: `/api/v1/p/${PROJECT}/runs/{runId}/remove-worktree` },

  // ---- variants (×2 / ×3) -------------------------------------------------
  group: { method: 'GET', path: `/api/v1/p/${PROJECT}/groups/{groupId}` },
  groupPick: { method: 'POST', path: `/api/v1/p/${PROJECT}/groups/{groupId}/pick` },

  // ---- workflows ----------------------------------------------------------
  // The catalog is one route for read AND write: there is no `GET /workflows/:name`, so a
  // by-name read filters the catalog client-side, and saving is a POST that upserts only when
  // `overwrite` is set.
  workflows: { method: 'GET', path: `/api/v1/p/${PROJECT}/workflows` },
  saveWorkflow: { method: 'POST', path: `/api/v1/p/${PROJECT}/workflows` },
  deleteWorkflow: { method: 'DELETE', path: `/api/v1/p/${PROJECT}/workflows/{name}` },

  // ---- skills -------------------------------------------------------------
  // Read-only over HTTP: `GET /skills` serves the whole catalog INCLUDING each body. cezar
  // exposes no skill write route (skills are files the user authors), so there is nothing to
  // point a create/update/delete tool at.
  skills: { method: 'GET', path: `/api/v1/p/${PROJECT}/skills` },

  // ---- projects (workspace-level, never project-scoped) -------------------
  projects: { method: 'GET', path: '/api/v1/projects' },
  addProject: { method: 'POST', path: '/api/v1/projects' },
  removeProject: { method: 'DELETE', path: '/api/v1/projects/{projectId}' },
  updateProject: { method: 'PATCH', path: '/api/v1/projects/{projectId}' },

  // ---- forge (GitHub/GitLab/Gitea…) --------------------------------------
  // One list route serves both kinds; the search route is per-kind.
  forgeList: { method: 'GET', path: `/api/v1/p/${PROJECT}/github` },
  forgeSearch: { method: 'GET', path: `/api/v1/p/${PROJECT}/github/search` },
  forgeRefStatus: { method: 'GET', path: `/api/v1/p/${PROJECT}/github/ref-status` },

  // ---- issue trackers -----------------------------------------------------
  trackerList: { method: 'GET', path: `/api/v1/p/${PROJECT}/tracker` },
  trackerSearch: { method: 'GET', path: `/api/v1/p/${PROJECT}/tracker/search` },
  trackerItem: { method: 'GET', path: `/api/v1/p/${PROJECT}/tracker/{id}` },
  trackerConnection: { method: 'GET', path: `/api/v1/p/${PROJECT}/tracker/connection` },

  // ---- automations --------------------------------------------------------
  automations: { method: 'GET', path: `/api/v1/p/${PROJECT}/automations` },
  createAutomation: { method: 'POST', path: `/api/v1/p/${PROJECT}/automations` },
  automation: { method: 'GET', path: `/api/v1/p/${PROJECT}/automations/{automationId}` },
  updateAutomation: { method: 'PUT', path: `/api/v1/p/${PROJECT}/automations/{automationId}` },
  deleteAutomation: { method: 'DELETE', path: `/api/v1/p/${PROJECT}/automations/{automationId}` },
  enableAutomation: { method: 'POST', path: `/api/v1/p/${PROJECT}/automations/{automationId}/enable` },
  pauseAutomation: { method: 'POST', path: `/api/v1/p/${PROJECT}/automations/{automationId}/pause` },
  runAutomation: { method: 'POST', path: `/api/v1/p/${PROJECT}/automations/{automationId}/run` },

  // ---- dashboard (workspace-level) ---------------------------------------
  dashboard: { method: 'GET', path: '/api/v1/workspace/dashboard' },
  dashboardOverview: { method: 'GET', path: '/api/v1/workspace/dashboard/overview' },
  dashboardCosts: { method: 'GET', path: '/api/v1/workspace/dashboard/costs' },
  dashboardInsights: { method: 'GET', path: '/api/v1/workspace/dashboard/insights' },
  runsIndex: { method: 'GET', path: '/api/v1/workspace/runs-index' },

  // ---- repo / git (project-scoped) ---------------------------------------
  // `GET /repo` is the one route: it answers `{ info, status, log, branches, baseBranch }`.
  repo: { method: 'GET', path: `/api/v1/p/${PROJECT}/repo` },

  // ---- agents -------------------------------------------------------------
  agentConfig: { method: 'GET', path: '/api/v1/agent-config' },
  agentProfiles: { method: 'GET', path: '/api/v1/workspace/agent-profiles' },
  models: { method: 'GET', path: '/api/v1/models' },

  // ---- system -------------------------------------------------------------
  health: { method: 'GET', path: '/api/v1/health' },
} as const satisfies Record<string, McpEndpoint>;

export type EndpointKey = keyof typeof ENDPOINTS;

/** Substitute `{name}` placeholders. A missing key throws rather than sending a literal brace. */
export function fillPath(template: string, params: Record<string, string> = {}): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`missing path parameter: ${name}`);
    return encodeURIComponent(value);
  });
}
