#!/usr/bin/env node
/**
 * MCP server for cezar — a thin, typed bridge from the Model Context Protocol to a running
 * cezar cockpit's HTTP API.
 *
 * A client (Claude Desktop, Cline, Continue, any MCP host) calls a tool; this process turns it
 * into one `fetch` against `http://127.0.0.1:4321` (or `$CEZ_API_URL`) and hands the JSON back
 * as text content.
 *
 * Every endpoint it speaks lives in `./endpoints.ts` as data, and
 * `packages/cezar/src/server/mcp-endpoint-drift.test.ts` asserts each one against a built app's
 * route table — so a route rename fails a test instead of silently 404-ing a tool.
 *
 * Configuration (first match wins):
 *   CEZ_API_URL / CEZAR_URL          cockpit base URL   (default http://127.0.0.1:4321)
 *   CEZ_PROJECT_ID / CEZAR_PROJECT_ID project scope     (default `default`)
 *
 * `CEZ_API_URL` and `CEZ_PROJECT_ID` are the same variables cezar exports into a dispatched
 * task, so inside a cezar task this server targets the cockpit that launched it with no setup.
 *
 * Usage: cezar-mcp [--help]
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  type Tool,
  type Resource,
} from '@modelcontextprotocol/sdk/types.js';

import { ENDPOINTS, fillPath, PROJECT_PARAM, type McpEndpoint } from './endpoints.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** cezar's own default cockpit port (`packages/cezar/src/index.ts`). The old 5192 here meant
 *  every tool failed against a stock install. */
const DEFAULT_CEZAR_URL = 'http://127.0.0.1:4321';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

const CEZAR_URL = trimTrailingSlash(
  process.env.CEZ_API_URL || process.env.CEZAR_URL || DEFAULT_CEZAR_URL,
);
const PROJECT_ID = process.env.CEZ_PROJECT_ID || process.env.CEZAR_PROJECT_ID || 'default';

/** Backends a task may be launched on — mirrors `RUNNER_IDS` in
 *  `packages/cezar/src/core/agent-runner.ts`. */
const RUNNER_IDS = [
  'claude',
  'codex',
  'opencode',
  'cursor',
  'pi',
  'junie',
  'copilot',
  'kilo',
  'gemini',
  'antigravity',
  'http',
] as const;

/** The subset `GET /models` discovers models for (`modelDiscoveryRunnerSchema`). */
const MODEL_DISCOVERY_RUNNERS = ['claude', 'codex', 'opencode', 'cursor', 'junie'] as const;

const RUN_STATUSES = [
  'queued',
  'running',
  'waiting',
  'review',
  'done',
  'failed',
  'cancelled',
] as const;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

interface CallOptions {
  /** Path-template placeholders (`{runId}`, …). `{projectId}` is filled automatically. */
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

function buildUrl(endpoint: McpEndpoint, options: CallOptions): string {
  const path = fillPath(endpoint.path, { [PROJECT_PARAM]: PROJECT_ID, ...options.params });
  const url = new URL(`${CEZAR_URL}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * One cezar API call. Non-2xx becomes a thrown Error carrying the server's own message (cezar
 * answers `{ error }` on failures), so the MCP client sees why rather than a bare status.
 *
 * The response is decoded by its content type: most routes answer JSON, but `GET
 * /runs/:id/diff` answers `text/plain` (a raw diff), and calling `.json()` on it would throw.
 */
async function cezarApi(endpoint: McpEndpoint, options: CallOptions = {}): Promise<unknown> {
  const init: RequestInit = { method: endpoint.method };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = { 'Content-Type': 'application/json' };
  }

  const response = await fetch(buildUrl(endpoint, options), init);
  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const text = await response.text();
      if (text) detail = isJson ? (JSON.parse(text).error ?? text) : text;
    } catch {
      /* keep the status line */
    }
    throw new Error(`cezar API error (${endpoint.method} ${endpoint.path}): ${detail}`);
  }

  if (isJson) return response.json();
  return response.text();
}

/** Convenience for the many `GET /runs/:id/…` tools. */
function runCall(endpoint: McpEndpoint, taskId: string, options: CallOptions = {}) {
  return cezarApi(endpoint, { ...options, params: { ...options.params, runId: taskId } });
}

/** `GET /projects` wraps its rows; every by-id project tool reads through this. */
async function findProject(projectId: string): Promise<unknown> {
  const data = (await cezarApi(ENDPOINTS.projects)) as { projects?: Array<{ id: string }> };
  const project = data.projects?.find((p) => p.id === projectId);
  if (!project) throw new Error(`unknown project: ${projectId}`);
  return project;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

/** One entry of a workflow chain (`workflowStepSchema`). A step is an AGENT step (`prompt` or
 *  `skill`) XOR a CHECK step (`command`); `id` is required and is what `onFail.retry` names. */
const WORKFLOW_STEP_SCHEMA = {
  type: 'object',
  description:
    'One step. Agent step: `prompt` or `skill` (optionally `model`, `runner`, `allowedTools`). Check step: `command`. `id` is required.',
  properties: {
    id: { type: 'string', description: 'Step id — unique in the chain; `onFail.retry` names it' },
    name: { type: 'string', description: 'Display label' },
    prompt: { type: 'string', description: 'Agent step: the prompt to run' },
    skill: { type: 'string', description: 'Agent step: a skill name to run instead of a prompt' },
    command: { type: 'string', description: 'Check step: a shell command whose exit code decides' },
    model: { type: 'string' },
    runner: { type: 'string', enum: [...RUNNER_IDS] },
    allowedTools: { type: 'array', items: { type: 'string' } },
    bashAllowlist: { type: 'array', items: { type: 'string' } },
    onFail: {
      type: 'object',
      description: 'Retry an EARLIER step (by id) when this check fails',
      properties: {
        retry: { type: 'string', description: 'The id of the step to loop back to' },
        max: { type: 'number', description: 'Maximum retries (default 2)' },
        retryOn: { type: 'array', items: { type: 'number' }, description: 'Exit codes that loop back' },
      },
      required: ['retry'],
    },
  },
  required: ['id'],
} as const;

/** A scheduled automation's trigger (`automationScheduleSchema`) — four bounded shapes, never a
 *  cron string (a cron is DERIVED for display, never stored or evaluated). */
const SCHEDULE_SCHEMA = {
  type: 'object',
  description: 'Schedule trigger. `type: daily|weekdays|weekly|hours`.',
  properties: {
    type: { type: 'string', enum: ['daily', 'weekdays', 'weekly', 'hours'] },
    hour: { type: 'number', description: '0-23 (daily/weekdays/weekly; default 4)' },
    minute: { type: 'number', description: '0-59 (daily/weekdays/weekly; default 0)' },
    day: { type: 'number', description: 'ISO weekday 1=Mon…7=Sun (weekly; default 1)' },
    every: { type: 'number', enum: [1, 2, 3, 4, 6, 8, 12], description: 'Hours between runs (hours; default 6)' },
  },
  required: ['type'],
} as const;

/** A tracker automation's trigger (`trackerTriggerSchema`). */
const TRACKER_TRIGGER_SCHEMA = {
  type: 'object',
  description: 'Tracker trigger. `association` is the captured tracker connection the poll runs against.',
  properties: {
    events: { type: 'array', items: { type: 'string' }, description: 'Tracker events to react to (1-4)' },
    association: { type: 'object', description: 'The tracker association captured from GET /tracker/connection' },
    targetStatusIds: { type: 'array', items: { type: 'string' } },
    changedLabelIds: { type: 'array', items: { type: 'string' } },
    requiredLabels: { type: 'array', items: { type: 'string' } },
  },
  required: ['events', 'association'],
} as const;

/** The bounded candidate filter (`automationFiltersSchema`). A github automation must carry one;
 *  `lookbackDays` and `maxRecords` are required inside it. */
const AUTOMATION_FILTERS_SCHEMA = {
  type: 'object',
  description: 'Bounded candidate filter. Required for a github automation.',
  properties: {
    authors: { type: 'array', items: { type: 'string' } },
    assignees: { type: 'array', items: { type: 'string' } },
    allLabels: { type: 'array', items: { type: 'string' } },
    anyLabels: { type: 'array', items: { type: 'string' } },
    excludeLabels: { type: 'array', items: { type: 'string' } },
    changedLabels: { type: 'array', items: { type: 'string' }, description: 'Required for the two label events' },
    reviewers: { type: 'array', items: { type: 'string' } },
    status: { type: 'string' },
    lookbackDays: { type: 'number', description: 'How far back to poll' },
    maxRecords: { type: 'number', description: 'Ceiling on candidates per poll' },
  },
  required: ['lookbackDays', 'maxRecords'],
} as const;

/** What a match launches (`automationTaskSchema`) — `POST /runs`' own body minus the keys the
 *  automation owns itself, with the prompt as a TEMPLATE. */
const AUTOMATION_TASK_SCHEMA = {
  type: 'object',
  description:
    'The task a match launches. `prompt` is a TEMPLATE — `{{github.number}}`, `{{github.title}}`, `{{github.url}}`, `{{github.labels}}` are substituted per match.',
  properties: {
    prompt: { type: 'string', description: 'Prompt template' },
    workflow: { type: 'string' },
    steps: { type: 'array', items: WORKFLOW_STEP_SCHEMA },
    runner: { type: 'string', enum: [...RUNNER_IDS] },
    model: { type: 'string' },
    agentProfile: { type: 'string' },
    autonomous: { type: 'boolean' },
    worktree: { type: 'boolean' },
    variants: { type: 'number', enum: [1, 2, 3] },
    systemPrompt: { type: 'string' },
    dispatch: {
      type: 'object',
      description: 'Let the launched run delegate to children',
      properties: {
        maxSubtasks: { type: 'number' },
        reviewChild: { type: 'boolean', description: 'Ask the run for a final review child' },
      },
    },
  },
  required: ['prompt'],
} as const;

const TOOLS: Tool[] = [
  // ==========================================================================
  // TASKS
  // ==========================================================================
  {
    name: 'cezar_create_task',
    description:
      'Create a new coding task. Supports variants (×2/×3), autonomous mode, a custom workflow or an inline step list, dispatch delegation and queue-only mode.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task description/prompt for the agent' },
        workflow: { type: 'string', description: 'Workflow name (default: quick-task)' },
        steps: {
          type: 'array',
          description: 'Inline step list instead of a named workflow (mutually exclusive with `workflow`), max 8',
          items: WORKFLOW_STEP_SCHEMA,
        },
        runner: { type: 'string', enum: [...RUNNER_IDS], description: 'Agent backend' },
        model: { type: 'string', description: 'Specific model to use' },
        agentProfile: { type: 'string', description: 'Agent account/profile id' },
        autonomous: { type: 'boolean', description: 'Run without review gates' },
        variants: { type: 'number', enum: [1, 2, 3], description: 'Number of parallel variants (default: 1)' },
        worktree: { type: 'boolean', description: 'Use an isolated worktree (default: true)' },
        queueOnly: { type: 'boolean', description: 'Add to the queue paused; start it manually later' },
        systemPrompt: { type: 'string', description: 'Per-run system-prompt override (max 20k chars)' },
        taskGroupId: { type: 'string', description: 'User-defined task group id' },
        taskGroupName: { type: 'string', description: 'User-defined task group name' },
        dispatch: {
          type: 'object',
          description:
            'Let this task delegate to child tasks (spec 2026-09-10-dispatch). Any subset of {maxSubtasks, inFlight, runner, model, budgetUsd}.',
          properties: {
            maxSubtasks: { type: 'number', description: 'Ceiling on children under this root, in total' },
            inFlight: { type: 'number', description: 'Ceiling on children running at once' },
            runner: { type: 'string', enum: [...RUNNER_IDS] },
            model: { type: 'string' },
            budgetUsd: { type: 'number', description: 'Budget in USD for children' },
          },
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'cezar_list_tasks',
    description: 'List tasks with filtering. Returns ids, titles, statuses, branches, costs and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: [...RUN_STATUSES] },
        limit: { type: 'number', description: 'Maximum results' },
        archived: { type: 'boolean', description: 'Include archived tasks (default: false)' },
      },
    },
  },
  {
    name: 'cezar_get_task',
    description: 'Get detailed task information including steps, usage, tokens, cost and current state.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_edit_task',
    description: 'Edit a task title, or its prompt while the task is still queued.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        title: { type: 'string', description: 'New title (1-300 chars)' },
        task: { type: 'string', description: 'New prompt (only while queued)' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_delete_task',
    description: 'Delete a finished task (done/failed/cancelled). Active tasks must be cancelled first.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_archive_task',
    description: 'Archive or unarchive a task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        archived: { type: 'boolean', description: 'true to archive, false to unarchive' },
      },
      required: ['taskId', 'archived'],
    },
  },
  {
    name: 'cezar_pin_task',
    description: 'Pin or unpin a task (pinned tasks sort to the top of the list).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        pinned: { type: 'boolean', description: 'true to pin, false to unpin' },
      },
      required: ['taskId', 'pinned'],
    },
  },
  {
    name: 'cezar_mark_task_read',
    description: 'Mark a task as read or unread.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        unread: { type: 'boolean', description: 'true to mark unread, false to mark read' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_archive_all_finished',
    description: 'Archive every finished task (done/failed/cancelled) in the current project.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_mark_all_read',
    description: 'Mark all finished tasks as read.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_send_message',
    description: 'Send a message to a waiting or running task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        text: { type: 'string', description: 'Message text' },
      },
      required: ['taskId', 'text'],
    },
  },
  {
    name: 'cezar_cancel_task',
    description: 'Cancel a running or queued task.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_finish_task',
    description: 'Manually finish a running task (force completion).',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_continue_task',
    description: 'Continue/resume a finished task, optionally with a new instruction.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        text: { type: 'string', description: 'Instruction to continue with' },
        runner: { type: 'string', enum: [...RUNNER_IDS], description: 'Reopen on a different backend' },
        model: { type: 'string', description: 'Reopen on a different model' },
        agentProfile: { type: 'string', description: 'Agent account for the reopened session' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_cancel_auto_resume',
    description: 'Cancel a pending automatic resume (scheduled after a usage limit).',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_get_task_diff',
    description: 'Get the git diff a task produced (its worktree against its base branch), as raw diff text.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_get_task_commits',
    description: 'List the commits a task made.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_get_task_changes',
    description: 'Get detailed file changes (added/modified/deleted, with per-file diffs).',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_commit_task',
    description: 'Create a git commit in the task worktree (git add -A && git commit).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        message: { type: 'string', description: 'Commit message' },
      },
      required: ['taskId', 'message'],
    },
  },
  {
    name: 'cezar_push_task',
    description: 'Push the task branch to its remote (sets upstream when needed).',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_create_pr',
    description: 'Create a draft pull request for the task.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_remove_worktree',
    description: 'Remove a task worktree directory (keeps the branch).',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_start_queued_task',
    description:
      'Start a task created with queueOnly (it sits paused in the queue until started). This is the ONLY way out of the queue — without it a queued task stays queued forever.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_dispatch_task',
    description:
      'Make an EXISTING task delegate: create one child task under it (spec 2026-09-10-dispatch). Creation-time delegation is the `dispatch` argument of cezar_create_task; this is the same for a task already running. Refusals (child cap, budget, settled parent) come back as the reason.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The parent task id' },
        objective: { type: 'string', description: 'The whole assignment the child receives' },
        title: { type: 'string', description: 'Short label for the child task' },
        kind: { type: 'string', enum: ['implement', 'review'], description: 'review makes it a reviewer of a branch' },
        reviewOf: { type: 'array', items: { type: 'string' }, description: 'Branch(es) or run ids a review child inspects' },
        scope: { type: 'string', description: 'Files or directories the child may touch' },
        allowedTools: { type: 'array', items: { type: 'string' }, description: 'Tools the child may use' },
        maxCost: { type: 'number', description: 'Hard cost ceiling for the child, in USD' },
        successCriteria: { type: 'string', description: 'How the child knows it is done' },
        requiredEvidence: { type: 'string', description: 'What the child must show in its report' },
        retryLimit: { type: 'integer', description: 'Retries allowed, 0–3' },
        runner: { type: 'string', enum: [...RUNNER_IDS], description: 'Child backend (default: the parent\'s)' },
        model: { type: 'string', description: 'Child model (default: the parent\'s)' },
      },
      required: ['taskId', 'objective'],
    },
  },
  {
    name: 'cezar_report_task',
    description:
      'Record a task\'s own report (the cezar dispatch protocol: status, result, evidence). Refused with 404 when the task is not part of a dispatch tree.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        status: { type: 'string', enum: ['done', 'partial', 'failed', 'blocked'] },
        result: { type: 'string', description: 'What was done and the state now' },
        evidence: { type: 'array', items: { type: 'string' }, description: 'Commands run and what they printed' },
        confidence: { type: 'number', description: '0–1' },
        sideEffects: { type: 'array', items: { type: 'string' } },
        errors: { type: 'array', items: { type: 'string' } },
        recommendedNextAction: { type: 'string' },
        verdict: { type: 'string', enum: ['approve', 'changes', 'reject'], description: 'A review task\'s verdict on the branch it reviewed' },
        suggestions: { type: 'array', items: { type: 'string' }, description: 'What the root should know, outside this task\'s order' },
      },
      required: ['taskId', 'status', 'result'],
    },
  },
  {
    name: 'cezar_edit_queued_message',
    description:
      'Rewrite the text of one message stacked on a queued task. The task must still be queued. (The route also accepts image attachments; this tool sends text only.)',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        messageId: { type: 'string', description: 'Id from the task\'s queuedMessages' },
        text: { type: 'string', description: 'The message\'s new text' },
      },
      required: ['taskId', 'messageId', 'text'],
    },
  },
  {
    name: 'cezar_delete_queued_message',
    description: 'Remove one message stacked on a queued task. The task must still be queued.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        messageId: { type: 'string' },
      },
      required: ['taskId', 'messageId'],
    },
  },
  {
    name: 'cezar_reorder_queue',
    description: 'Set the order the queued tasks will be started in (the whole list, by id).',
    inputSchema: {
      type: 'object',
      properties: {
        taskIds: { type: 'array', items: { type: 'string' }, description: 'Every queued task id, in the wanted order' },
      },
      required: ['taskIds'],
    },
  },
  {
    name: 'cezar_get_task_history',
    description:
      'Read a task\'s event history (the run\'s NDJSON), newest page first. Pass the cursor from the previous page to walk further back.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        cursor: { type: 'string', description: 'Opaque cursor from the previous page' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_get_task_history_context',
    description: 'The context events of a task\'s history — what the agent was told, as opposed to what it did.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_get_task_handoff',
    description: 'Read a task\'s handoff journal (handoff.md) as markdown — the resume notes and progress log a task leaves behind.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },

  // ==========================================================================
  // VARIANTS (×2, ×3)
  // ==========================================================================
  {
    name: 'cezar_get_variants',
    description: 'Get every variant of a task group (the ×2/×3 siblings).',
    inputSchema: {
      type: 'object',
      properties: { groupId: { type: 'string', description: 'Group id from the task' } },
      required: ['groupId'],
    },
  },
  {
    name: 'cezar_pick_variant',
    description: 'Pick the winning variant (cancels the others, archives them and removes their worktrees).',
    inputSchema: {
      type: 'object',
      properties: {
        groupId: { type: 'string' },
        winnerId: { type: 'string', description: 'Task id of the winning variant' },
      },
      required: ['groupId', 'winnerId'],
    },
  },

  // ==========================================================================
  // WORKFLOWS
  // ==========================================================================
  {
    name: 'cezar_list_workflows',
    description: 'List all available workflows (built-in and saved), plus any files that failed to load.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_get_workflow',
    description: 'Get one workflow definition (steps, checks, skills) by name.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Workflow name' } },
      required: ['name'],
    },
  },
  {
    name: 'cezar_create_workflow',
    description:
      'Save a workflow as `.ai/cezar/workflows/<slug>.yaml`. Provide either `steps` or the portable `skills` shorthand, not both.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Workflow name' },
        description: { type: 'string', description: 'Short blurb' },
        steps: {
          type: 'array',
          description: 'Agent/check steps, max 8',
          items: WORKFLOW_STEP_SCHEMA,
        },
        skills: {
          type: 'array',
          description: 'Portable skill stack (mutually exclusive with `steps`)',
          items: { type: 'string' },
        },
        overwrite: { type: 'boolean', description: 'Replace an existing file (default: refuse with 409)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'cezar_update_workflow',
    description: 'Overwrite an existing saved workflow. Same body as create, with overwrite forced on.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        steps: { type: 'array', items: WORKFLOW_STEP_SCHEMA },
        skills: { type: 'array', items: { type: 'string' } },
      },
      required: ['name'],
    },
  },
  {
    name: 'cezar_delete_workflow',
    description: 'Delete a saved workflow (built-ins have no file and cannot be deleted).',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'cezar_list_workflow_nodes',
    description:
      'The node catalog for graph workflows (version 2): every node type, its fields and its ports. Read this before authoring a graph.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_validate_workflow',
    description:
      'Parse and validate a workflow YAML WITHOUT saving it — either form (a `steps` chain, or a version-2 graph). Answers the normalized definition when it is sound, or the parse/validation problems.',
    inputSchema: {
      type: 'object',
      properties: {
        yaml: { type: 'string', description: 'The workflow document to check' },
      },
      required: ['yaml'],
    },
  },
  {
    name: 'cezar_validate_workflow_graph',
    description:
      'Structural check of an unsaved version-2 graph (nodes + edges, no YAML): answers the issues the editor would show as you edit. See cezar_list_workflow_nodes for the node catalog.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: {
          type: 'object',
          description: 'A version-2 graph: { nodes, edges, layout? }. Node shapes are in cezar_list_workflow_nodes.',
          properties: {
            nodes: { type: 'array', items: { type: 'object' }, description: 'At least one node; each has an id and a type' },
            edges: {
              type: 'array',
              items: {
                type: 'object',
                properties: { from: { type: 'string' }, to: { type: 'string' } },
                required: ['from', 'to'],
              },
            },
            layout: { type: 'object', description: 'Optional node positions, keyed by node id' },
          },
          required: ['nodes', 'edges'],
        },
      },
      required: ['graph'],
    },
  },

  // ==========================================================================
  // SKILLS (read-only over HTTP)
  // ==========================================================================
  {
    name: 'cezar_list_skills',
    description: 'List all available skills (markdown playbooks for agents).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_get_skill',
    description: 'Get one skill (markdown body plus its source and path).',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Skill name' } },
      required: ['name'],
    },
  },

  // ==========================================================================
  // PROJECTS (multi-repo workspace)
  // ==========================================================================
  {
    name: 'cezar_list_projects',
    description: 'List every project in the workspace.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_get_project',
    description: 'Get one project’s registry entry and status.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'cezar_add_project',
    description: 'Register an existing folder as a project in the workspace.',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string', description: 'Absolute path to the project root' } },
      required: ['root'],
    },
  },
  {
    name: 'cezar_remove_project',
    description: 'Remove a project from the workspace.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'cezar_update_project',
    description:
      'Update a project’s workspace metadata. Only tags and maxParallel are editable — the display name is derived from the folder.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replacement tag list (null clears them)',
        },
        maxParallel: {
          type: 'number',
          description: 'Per-project concurrency cap (null inherits the workspace setting)',
        },
      },
      required: ['projectId'],
    },
  },

  // ==========================================================================
  // FORGE (GitHub and other forges)
  // ==========================================================================
  {
    name: 'cezar_list_github_issues',
    description: 'List the open issues of the project’s forge repository.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (server default 30)' },
        refresh: { type: 'boolean', description: 'Bypass the server-side cache' },
      },
    },
  },
  {
    name: 'cezar_list_github_prs',
    description: 'List the open pull requests of the project’s forge repository.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (server default 30)' },
        refresh: { type: 'boolean', description: 'Bypass the server-side cache' },
      },
    },
  },
  {
    name: 'cezar_search_github',
    description: 'Search issues and/or pull requests in ANY state (the list routes return the open set only).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        type: {
          type: 'string',
          enum: ['issues', 'prs', 'all'],
          description: 'What to search (default: all)',
        },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'cezar_get_github_ref_status',
    description: 'Get the status of a pull request or issue reference.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['pr', 'issue'] },
        number: { type: 'number', description: 'PR or issue number' },
      },
      required: ['type', 'number'],
    },
  },

  // ==========================================================================
  // TRACKERS (Jira, Linear)
  // ==========================================================================
  {
    name: 'cezar_list_tracker_items',
    description: 'List items from the connected issue tracker (Jira, Linear).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (1-100, server default 50)' },
        state: { type: 'string', enum: ['active', 'all'], description: 'Default: active' },
      },
    },
  },
  {
    name: 'cezar_search_tracker',
    description: 'Search the connected issue tracker (tracker-specific query syntax).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (1-100, server default 50)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'cezar_get_tracker_item',
    description: 'Get one item from the connected issue tracker.',
    inputSchema: {
      type: 'object',
      properties: { itemId: { type: 'string', description: 'Tracker item id (e.g. ABC-1)' } },
      required: ['itemId'],
    },
  },
  {
    name: 'cezar_get_tracker_connection',
    description: 'Get the current tracker connection (provider, scope, association).',
    inputSchema: { type: 'object', properties: {} },
  },

  // ==========================================================================
  // AUTOMATIONS
  // ==========================================================================
  {
    name: 'cezar_list_automations',
    description: 'List all automations (forge events, tracker events, schedules) with their runtime state.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_get_automation',
    description: 'Get one automation’s definition and runtime state.',
    inputSchema: {
      type: 'object',
      properties: { automationId: { type: 'string' } },
      required: ['automationId'],
    },
  },
  {
    name: 'cezar_create_automation',
    description:
      'Create an automation. `kind` defaults to github; a github automation needs `events` + `intervalSeconds` + `filters`, a schedule needs `schedule`, a tracker automation needs `trackerTrigger`. It is created paused unless `enable` is true.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        kind: { type: 'string', enum: ['github', 'schedule', 'tracker'] },
        enable: { type: 'boolean', description: 'Enable it right away (establishes a baseline)' },
        events: { type: 'array', items: { type: 'string' }, description: 'github: PR/issue events' },
        intervalSeconds: { type: 'number', description: 'github: poll interval (60-86400)' },
        filters: AUTOMATION_FILTERS_SCHEMA,
        schedule: SCHEDULE_SCHEMA,
        trackerTrigger: TRACKER_TRIGGER_SCHEMA,
        task: AUTOMATION_TASK_SCHEMA,
      },
      required: ['name', 'task'],
    },
  },
  {
    name: 'cezar_update_automation',
    description:
      'Update an automation. The current revision is read first and echoed back, so a concurrent edit is refused rather than overwritten.',
    inputSchema: {
      type: 'object',
      properties: {
        automationId: { type: 'string' },
        updates: {
          type: 'object',
          description: 'Editable fields to merge: name, description, enabled, events, intervalSeconds, filters, schedule, trackerTrigger, task',
        },
      },
      required: ['automationId', 'updates'],
    },
  },
  {
    name: 'cezar_delete_automation',
    description: 'Delete an automation.',
    inputSchema: {
      type: 'object',
      properties: { automationId: { type: 'string' } },
      required: ['automationId'],
    },
  },
  {
    name: 'cezar_enable_automation',
    description: 'Enable or pause an automation.',
    inputSchema: {
      type: 'object',
      properties: {
        automationId: { type: 'string' },
        enabled: { type: 'boolean' },
      },
      required: ['automationId', 'enabled'],
    },
  },
  {
    name: 'cezar_run_automation',
    description: 'Trigger an automation once, now, by hand.',
    inputSchema: {
      type: 'object',
      properties: { automationId: { type: 'string' } },
      required: ['automationId'],
    },
  },

  // ==========================================================================
  // DASHBOARD & INSIGHTS
  // ==========================================================================
  {
    name: 'cezar_get_dashboard',
    description: 'Get the workspace dashboard (tasks needing attention, running, recent).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_get_usage_stats',
    description: 'Get the workspace outcome overview: delivered/failed tasks and per-project metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['7d', '30d'], description: 'Window (default: 7d)' },
      },
    },
  },
  {
    name: 'cezar_get_cost_stats',
    description: 'Get token and cost statistics by project and backend.',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['all', '7d', '30d'], description: 'Window (default: all)' },
        sort: { type: 'string', enum: ['cost', 'input', 'output'], description: 'Sort key' },
      },
    },
  },
  {
    name: 'cezar_get_insights',
    description: 'Get workspace insights (delivery, failure categories, backend and automation stats).',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['7d', '30d'], description: 'Window (default: 7d)' },
      },
    },
  },
  {
    name: 'cezar_get_workspace_runs',
    description: 'Get recent tasks across every project in the workspace.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ==========================================================================
  // GIT & REPO
  // ==========================================================================
  {
    name: 'cezar_get_repo_info',
    description: 'Get repository information (root, remote, base branch, commit log).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_get_repo_status',
    description: 'Get git status for the project working tree (modified/untracked files, branch).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_get_branches',
    description: 'List the git branches of the project.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_get_repo_tree',
    description:
      'The repository’s whole path index (what `git ls-files` returns) — every file the Files view can open, in one bounded answer. Ignored and untracked paths are absent by construction.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_list_repo_files',
    description:
      'Read ONE file from the project’s real checkout (not a task worktree). Only a path in the repository index is readable — an ignored or untracked file answers 409.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repository-relative path, as cezar_get_repo_tree returned it' },
        raw: { type: 'boolean', description: 'Ask for the image bytes instead of the JSON answer (images only)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'cezar_get_repo_diff',
    description: 'The project working tree’s uncommitted diff vs HEAD, as raw patch text.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_get_repo_changes',
    description:
      'The project working tree’s uncommitted changes as structured data (added/modified/deleted, with per-file diffs and a stat). The JSON sibling of cezar_get_repo_diff.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_get_repo_commit',
    description: 'One commit of the project: its message, stat and patch.',
    inputSchema: {
      type: 'object',
      properties: {
        sha: {
          type: 'string',
          description:
            'A commit sha — 4 to 40 hex characters, as cezar_get_repo_info\'s log returns them. `HEAD` and other revs are NOT accepted: the route refuses anything that is not a hash.',
        },
        structured: {
          type: 'boolean',
          description: 'Structured answer ({sha, subject, author, when, files, stat}) instead of the raw patch',
        },
      },
      required: ['sha'],
    },
  },
  {
    name: 'cezar_create_repo_branch',
    description:
      'Switch the project to a branch, creating it first when it does not exist. Predictable git failures (bad name, unknown `from`, dirty-tree conflict) come back as the reason.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Branch to switch to (created when absent)' },
        from: { type: 'string', description: 'Base ref when creating (default: HEAD)' },
      },
      required: ['name'],
    },
  },

  // ==========================================================================
  // AGENT CONFIG & PROFILES
  // ==========================================================================
  {
    name: 'cezar_list_agent_configs',
    description: 'List the coding agents’ own config files (Claude, Codex, OpenCode settings, MCP, memory).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_list_agent_profiles',
    description: 'List agent account profiles.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_list_models',
    description: 'List the models discovered for one backend.',
    inputSchema: {
      type: 'object',
      properties: {
        runner: { type: 'string', enum: [...MODEL_DISCOVERY_RUNNERS] },
      },
      required: ['runner'],
    },
  },

  // ==========================================================================
  // SYSTEM
  // ==========================================================================
  {
    name: 'cezar_get_health',
    description: 'Get server health, capabilities and the available agents.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

const RESOURCES: Resource[] = [
  { uri: 'cezar://tasks', name: 'All Tasks', description: 'Every task in the project', mimeType: 'application/json' },
  { uri: 'cezar://tasks/active', name: 'Active Tasks', description: 'Running and queued tasks', mimeType: 'application/json' },
  { uri: 'cezar://tasks/needs-attention', name: 'Tasks Needing Attention', description: 'Waiting and review tasks', mimeType: 'application/json' },
  { uri: 'cezar://workflows', name: 'Workflows', description: 'Available workflows', mimeType: 'application/json' },
  { uri: 'cezar://skills', name: 'Skills', description: 'Available skills', mimeType: 'application/json' },
  { uri: 'cezar://projects', name: 'Projects', description: 'Workspace projects', mimeType: 'application/json' },
  { uri: 'cezar://dashboard', name: 'Dashboard', description: 'Workspace overview', mimeType: 'application/json' },
  { uri: 'cezar://github/issues', name: 'GitHub Issues', description: 'Open issues', mimeType: 'application/json' },
  { uri: 'cezar://github/prs', name: 'GitHub PRs', description: 'Open pull requests', mimeType: 'application/json' },
  { uri: 'cezar://automations', name: 'Automations', description: 'All automations', mimeType: 'application/json' },
  { uri: 'cezar://health', name: 'Server Health', description: 'Status and capabilities', mimeType: 'application/json' },
];

/** `cezar://` — the resource URI scheme. */
const RESOURCE_SCHEME = 'cezar://';

/**
 * Resolve a `cezar://…` resource URI to the text a client renders.
 *
 * The scheme is NOT special to `URL`, so `new URL('cezar://tasks')` parses `tasks` as the HOST
 * and leaves `pathname` EMPTY — reading the path off a `URL` made every one of these resources
 * answer "Unknown resource", which is how this read for as long as the resources have existed.
 * The remainder after the scheme is parsed as a plain path instead.
 */
async function readResource(uri: string): Promise<string> {
  const path = uri.startsWith(RESOURCE_SCHEME) ? uri.slice(RESOURCE_SCHEME.length) : uri;
  const segments = path.split('/').filter((part) => part.length > 0);
  const [head, second] = segments;

  switch (head) {
    case 'tasks': {
      if (second === 'active' || second === 'needs-attention') {
        const wanted = second === 'active' ? ['queued', 'running'] : ['waiting', 'review'];
        const runs = (await cezarApi(ENDPOINTS.listRuns)) as Array<{ status: string }>;
        return JSON.stringify(
          runs.filter((r) => wanted.includes(r.status)),
          null,
          2,
        );
      }
      // `cezar://tasks/<id>` — one task.
      if (second !== undefined) return JSON.stringify(await runCall(ENDPOINTS.getRun, second), null, 2);
      return JSON.stringify(await cezarApi(ENDPOINTS.listRuns), null, 2);
    }
    case 'workflows':
      return JSON.stringify(await cezarApi(ENDPOINTS.workflows), null, 2);
    case 'skills':
      return JSON.stringify(await cezarApi(ENDPOINTS.skills), null, 2);
    case 'projects':
      return JSON.stringify(await cezarApi(ENDPOINTS.projects), null, 2);
    case 'dashboard':
      return JSON.stringify(await cezarApi(ENDPOINTS.dashboard), null, 2);
    case 'github': {
      // One list route serves both kinds; the resource narrows it to the half its name promises.
      const data = (await cezarApi(ENDPOINTS.forgeList)) as { issues?: unknown; prs?: unknown };
      const items = second === 'prs' ? data.prs : data.issues;
      return JSON.stringify(items ?? data, null, 2);
    }
    case 'automations':
      return JSON.stringify(await cezarApi(ENDPOINTS.automations), null, 2);
    case 'health':
      return JSON.stringify(await cezarApi(ENDPOINTS.health), null, 2);
    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

type Args = Record<string, unknown>;

/** The editable half of an automation definition — what a PUT may carry. */
const AUTOMATION_EDITABLE_KEYS = [
  'name',
  'description',
  'enabled',
  'kind',
  'events',
  'intervalSeconds',
  'filters',
  'trackerTrigger',
  'schedule',
  'task',
] as const;

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing required string argument: ${field}`);
  }
  return value;
}

/** A required list of strings (`reorder-queue` wants every queued run id, in order). */
function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string')) {
    throw new Error(`missing required string-array argument: ${field}`);
  }
  return value as string[];
}

/** The keys of the strict `dispatch` intent `POST /runs` accepts (`dispatchIntentSchema`). */
const DISPATCH_INTENT_KEYS = ['maxSubtasks', 'inFlight', 'runner', 'model', 'budgetUsd'] as const;

/** Narrow a tool argument to a dispatch intent. An unknown key is DROPPED rather than passed
 *  through: the server's schema is a `strictObject`, so one extra key would 400 the whole task. */
function dispatchIntentOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('dispatch must be an object of {maxSubtasks, inFlight, runner, model, budgetUsd}');
  }
  const source = value as Record<string, unknown>;
  const intent: Record<string, unknown> = {};
  for (const key of DISPATCH_INTENT_KEYS) {
    if (source[key] !== undefined) intent[key] = source[key];
  }
  return intent;
}

async function handleToolCall(name: string, args: Args): Promise<unknown> {
  switch (name) {
    // ======================================================================
    // TASKS
    // ======================================================================
    case 'cezar_create_task': {
      const body: Record<string, unknown> = { task: asString(args.task, 'task') };
      // `POST /runs` takes a named workflow XOR an inline step list and REFUSES a body with
      // neither, so an omitted `workflow` means the zero-config built-in rather than nothing.
      if (args.workflow !== undefined) body.workflow = asString(args.workflow, 'workflow');
      else if (args.steps === undefined) body.workflow = 'quick-task';
      for (const key of [
        'steps',
        'runner',
        'model',
        'agentProfile',
        'autonomous',
        'variants',
        'worktree',
        'queueOnly',
        'systemPrompt',
        'taskGroupId',
        'taskGroupName',
      ]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      if (args.dispatch !== undefined) body.dispatch = dispatchIntentOf(args.dispatch);
      return cezarApi(ENDPOINTS.startRun, { body });
    }

    case 'cezar_list_tasks': {
      let runs = (await cezarApi(ENDPOINTS.listRuns)) as Array<Record<string, unknown>>;
      if (typeof args.status === 'string') runs = runs.filter((r) => r.status === args.status);
      if (!args.archived) runs = runs.filter((r) => !r.archived);
      if (typeof args.limit === 'number') runs = runs.slice(0, args.limit);
      return runs;
    }

    case 'cezar_get_task':
      return runCall(ENDPOINTS.getRun, asString(args.taskId, 'taskId'));

    case 'cezar_edit_task': {
      const body: Record<string, unknown> = {};
      if (args.title !== undefined) body.title = args.title;
      if (args.task !== undefined) body.task = args.task;
      return runCall(ENDPOINTS.patchRun, asString(args.taskId, 'taskId'), { body });
    }

    case 'cezar_delete_task':
      return runCall(ENDPOINTS.deleteRun, asString(args.taskId, 'taskId'));

    case 'cezar_archive_task':
      return runCall(ENDPOINTS.archiveRun, asString(args.taskId, 'taskId'), {
        body: { archived: args.archived !== false },
      });

    case 'cezar_pin_task':
      return runCall(ENDPOINTS.pinRun, asString(args.taskId, 'taskId'), {
        body: { pinned: args.pinned !== false },
      });

    case 'cezar_mark_task_read':
      return runCall(args.unread ? ENDPOINTS.unreadRun : ENDPOINTS.readRun, asString(args.taskId, 'taskId'));

    case 'cezar_archive_all_finished':
      return cezarApi(ENDPOINTS.archiveFinished);

    case 'cezar_mark_all_read':
      return cezarApi(ENDPOINTS.readAll);

    case 'cezar_send_message':
      return runCall(ENDPOINTS.sendMessage, asString(args.taskId, 'taskId'), {
        body: { text: asString(args.text, 'text') },
      });

    case 'cezar_cancel_task':
      return runCall(ENDPOINTS.cancelRun, asString(args.taskId, 'taskId'));

    case 'cezar_finish_task':
      return runCall(ENDPOINTS.finishRun, asString(args.taskId, 'taskId'));

    case 'cezar_continue_task': {
      const body: Record<string, unknown> = {};
      for (const key of ['text', 'runner', 'model', 'agentProfile']) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      return runCall(ENDPOINTS.continueRun, asString(args.taskId, 'taskId'), { body });
    }

    case 'cezar_cancel_auto_resume':
      return runCall(ENDPOINTS.cancelAutoResume, asString(args.taskId, 'taskId'));

    case 'cezar_get_task_diff':
      // `text/plain` on the wire — `cezarApi` already decodes by content type.
      return runCall(ENDPOINTS.runDiff, asString(args.taskId, 'taskId'));

    case 'cezar_get_task_commits':
      return runCall(ENDPOINTS.runCommits, asString(args.taskId, 'taskId'));

    case 'cezar_get_task_changes':
      return runCall(ENDPOINTS.runChanges, asString(args.taskId, 'taskId'));

    case 'cezar_commit_task':
      return runCall(ENDPOINTS.runGitCommit, asString(args.taskId, 'taskId'), {
        body: { message: asString(args.message, 'message') },
      });

    case 'cezar_push_task':
      return runCall(ENDPOINTS.runGitPush, asString(args.taskId, 'taskId'));

    case 'cezar_create_pr':
      return runCall(ENDPOINTS.runPr, asString(args.taskId, 'taskId'));

    case 'cezar_remove_worktree':
      return runCall(ENDPOINTS.removeWorktree, asString(args.taskId, 'taskId'));

    case 'cezar_start_queued_task':
      return runCall(ENDPOINTS.startQueuedRun, asString(args.taskId, 'taskId'));

    case 'cezar_reorder_queue':
      return cezarApi(ENDPOINTS.reorderQueue, {
        body: { runIds: asStringArray(args.taskIds, 'taskIds') },
      });

    case 'cezar_edit_queued_message': {
      const body: Record<string, unknown> = {};
      if (args.text !== undefined) body.text = args.text;
      // The route requires text OR images; with no text there is nothing this tool can send,
      // and a body of `{}` would be rejected as "message edit needs text or attachments".
      if (body.text === undefined) throw new Error('cezar_edit_queued_message needs `text`');
      return cezarApi(ENDPOINTS.editQueuedMessage, {
        params: {
          runId: asString(args.taskId, 'taskId'),
          msgId: asString(args.messageId, 'messageId'),
        },
        body,
      });
    }

    case 'cezar_delete_queued_message':
      return cezarApi(ENDPOINTS.deleteQueuedMessage, {
        params: {
          runId: asString(args.taskId, 'taskId'),
          msgId: asString(args.messageId, 'messageId'),
        },
      });

    case 'cezar_dispatch_task': {
      const runId = asString(args.taskId, 'taskId');
      const body: Record<string, unknown> = {
        objective: asString(args.objective, 'objective'),
      };
      // `dispatchInputSchema` is a strictObject and snake_cases its own keys — an unknown key is
      // a 400, so map explicitly rather than forwarding whatever the client sent.
      for (const [toolKey, routeKey] of [
        ['title', 'title'],
        ['kind', 'kind'],
        ['reviewOf', 'review_of'],
        ['scope', 'scope'],
        ['allowedTools', 'allowed_tools'],
        ['maxCost', 'max_cost'],
        ['successCriteria', 'success_criteria'],
        ['requiredEvidence', 'required_evidence'],
        ['retryLimit', 'retry_limit'],
        ['runner', 'runner'],
        ['model', 'model'],
      ] as const) {
        if (args[toolKey] !== undefined) body[routeKey] = args[toolKey];
      }
      return cezarApi(ENDPOINTS.dispatchRun, { params: { runId }, body });
    }

    case 'cezar_report_task': {
      const body: Record<string, unknown> = {
        status: asString(args.status, 'status'),
        result: asString(args.result, 'result'),
      };
      for (const [toolKey, routeKey] of [
        ['evidence', 'evidence'],
        ['confidence', 'confidence'],
        ['sideEffects', 'side_effects'],
        ['errors', 'errors'],
        ['recommendedNextAction', 'recommended_next_action'],
        ['verdict', 'verdict'],
        ['suggestions', 'suggestions'],
      ] as const) {
        if (args[toolKey] !== undefined) body[routeKey] = args[toolKey];
      }
      return cezarApi(ENDPOINTS.reportRun, {
        params: { runId: asString(args.taskId, 'taskId') },
        body,
      });
    }

    case 'cezar_get_task_history': {
      const query: Record<string, string | undefined> = {};
      if (args.cursor !== undefined) query.cursor = asString(args.cursor, 'cursor');
      return cezarApi(ENDPOINTS.runHistory, {
        params: { runId: asString(args.taskId, 'taskId') },
        query,
      });
    }

    case 'cezar_get_task_history_context':
      return runCall(ENDPOINTS.runHistoryContext, asString(args.taskId, 'taskId'));

    // Answers `text/markdown`, so `cezarApi` hands back the raw string.
    case 'cezar_get_task_handoff':
      return runCall(ENDPOINTS.runHandoff, asString(args.taskId, 'taskId'));

    // ======================================================================
    // VARIANTS
    // ======================================================================
    case 'cezar_get_variants':
      return cezarApi(ENDPOINTS.group, { params: { groupId: asString(args.groupId, 'groupId') } });

    case 'cezar_pick_variant':
      return cezarApi(ENDPOINTS.groupPick, {
        params: { groupId: asString(args.groupId, 'groupId') },
        // The route's body key is `runId`; the tool calls it the winner.
        body: { runId: asString(args.winnerId, 'winnerId') },
      });

    // ======================================================================
    // WORKFLOWS
    // ======================================================================
    case 'cezar_list_workflows':
      return cezarApi(ENDPOINTS.workflows);

    case 'cezar_get_workflow': {
      // No by-name route: the catalog carries every definition, so filter it.
      const name = asString(args.name, 'name');
      const data = (await cezarApi(ENDPOINTS.workflows)) as {
        workflows?: Array<{ name: string }>;
      };
      const workflow = data.workflows?.find((w) => w.name === name);
      if (!workflow) throw new Error(`unknown workflow: ${name}`);
      return workflow;
    }

    case 'cezar_create_workflow':
    case 'cezar_update_workflow': {
      const body: Record<string, unknown> = { name: asString(args.name, 'name') };
      if (args.description !== undefined) body.description = args.description;
      if (args.steps !== undefined) body.steps = args.steps;
      if (args.skills !== undefined) body.skills = args.skills;
      // Create refuses to clobber; update is defined as "replace what is there".
      body.overwrite = name === 'cezar_update_workflow' ? true : args.overwrite === true;
      return cezarApi(ENDPOINTS.saveWorkflow, { body });
    }

    case 'cezar_delete_workflow':
      return cezarApi(ENDPOINTS.deleteWorkflow, { params: { name: asString(args.name, 'name') } });

    case 'cezar_list_workflow_nodes':
      return cezarApi(ENDPOINTS.workflowNodes);

    case 'cezar_validate_workflow':
      return cezarApi(ENDPOINTS.parseWorkflow, {
        body: { yaml: asString(args.yaml, 'yaml') },
      });

    case 'cezar_validate_workflow_graph':
      return cezarApi(ENDPOINTS.validateWorkflowGraph, { body: { graph: args.graph } });

    // ======================================================================
    // SKILLS
    // ======================================================================
    case 'cezar_list_skills':
      return cezarApi(ENDPOINTS.skills);

    case 'cezar_get_skill': {
      const name = asString(args.name, 'name');
      const skills = (await cezarApi(ENDPOINTS.skills)) as Array<{ name: string }>;
      const skill = skills.find((s) => s.name === name);
      if (!skill) throw new Error(`unknown skill: ${name}`);
      return skill;
    }

    // ======================================================================
    // PROJECTS
    // ======================================================================
    case 'cezar_list_projects':
      return cezarApi(ENDPOINTS.projects);

    case 'cezar_get_project':
      return findProject(asString(args.projectId, 'projectId'));

    case 'cezar_add_project':
      return cezarApi(ENDPOINTS.addProject, { body: { root: asString(args.root, 'root') } });

    case 'cezar_remove_project':
      return cezarApi(ENDPOINTS.removeProject, {
        params: { projectId: asString(args.projectId, 'projectId') },
      });

    case 'cezar_update_project': {
      const body: Record<string, unknown> = {};
      if (args.tags !== undefined) body.tags = args.tags;
      if (args.maxParallel !== undefined) body.maxParallel = args.maxParallel;
      return cezarApi(ENDPOINTS.updateProject, {
        params: { projectId: asString(args.projectId, 'projectId') },
        body,
      });
    }

    // ======================================================================
    // FORGE
    // ======================================================================
    case 'cezar_list_github_issues':
    case 'cezar_list_github_prs': {
      const data = (await cezarApi(ENDPOINTS.forgeList, {
        query: {
          limit: typeof args.limit === 'number' ? args.limit : undefined,
          refresh: args.refresh === true ? 1 : undefined,
        },
      })) as { available: boolean; reason?: string; issues?: unknown[]; prs?: unknown[] };
      if (!data.available) {
        return { available: false, reason: data.reason ?? 'the forge is unavailable' };
      }
      const items = name === 'cezar_list_github_issues' ? data.issues : data.prs;
      return { available: true, items: items ?? [] };
    }

    case 'cezar_search_github': {
      const query = asString(args.query, 'query');
      const kind = args.type === 'issues' ? 'issue' : args.type === 'prs' ? 'pr' : 'all';
      const limit = typeof args.limit === 'number' ? args.limit : undefined;
      const search = (k: 'issue' | 'pr') =>
        cezarApi(ENDPOINTS.forgeSearch, { query: { kind: k, q: query, limit } });
      if (kind === 'all') {
        const [issues, prs] = await Promise.all([search('issue'), search('pr')]);
        return { issues, prs };
      }
      return search(kind);
    }

    case 'cezar_get_github_ref_status': {
      const type = args.type === 'issue' ? 'issues' : 'prs';
      return cezarApi(ENDPOINTS.forgeRefStatus, {
        query: { [type]: String(args.number) },
      });
    }

    // ======================================================================
    // TRACKERS
    // ======================================================================
    case 'cezar_list_tracker_items':
      return cezarApi(ENDPOINTS.trackerList, {
        query: {
          limit: typeof args.limit === 'number' ? args.limit : undefined,
          state: typeof args.state === 'string' ? args.state : undefined,
        },
      });

    case 'cezar_search_tracker':
      return cezarApi(ENDPOINTS.trackerSearch, {
        query: {
          q: asString(args.query, 'query'),
          limit: typeof args.limit === 'number' ? args.limit : undefined,
        },
      });

    case 'cezar_get_tracker_item':
      return cezarApi(ENDPOINTS.trackerItem, {
        params: { id: asString(args.itemId, 'itemId') },
      });

    case 'cezar_get_tracker_connection':
      return cezarApi(ENDPOINTS.trackerConnection);

    // ======================================================================
    // AUTOMATIONS
    // ======================================================================
    case 'cezar_list_automations':
      return cezarApi(ENDPOINTS.automations);

    case 'cezar_get_automation':
      return cezarApi(ENDPOINTS.automation, {
        params: { automationId: asString(args.automationId, 'automationId') },
      });

    case 'cezar_create_automation': {
      const body: Record<string, unknown> = { name: args.name, task: args.task };
      for (const key of [
        'description',
        'kind',
        'enable',
        'events',
        'intervalSeconds',
        'filters',
        'schedule',
        'trackerTrigger',
      ]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      return cezarApi(ENDPOINTS.createAutomation, { body });
    }

    case 'cezar_update_automation': {
      const automationId = asString(args.automationId, 'automationId');
      const updates = (args.updates ?? {}) as Record<string, unknown>;
      // The PUT is optimistic-concurrency: it must echo the revision it read. Reading first is
      // the only correct way to do that from a one-shot tool call.
      const current = (await cezarApi(ENDPOINTS.automation, { params: { automationId } })) as {
        automation?: Record<string, unknown>;
      } & Record<string, unknown>;
      const definition = (current.automation ?? current) as Record<string, unknown>;
      const revision = definition.revision;
      if (typeof revision !== 'number') {
        throw new Error(`automation ${automationId} did not report a revision`);
      }
      const body: Record<string, unknown> = { expectedRevision: revision };
      for (const key of AUTOMATION_EDITABLE_KEYS) {
        const value = updates[key] !== undefined ? updates[key] : definition[key];
        if (value !== undefined) body[key] = value;
      }
      return cezarApi(ENDPOINTS.updateAutomation, { params: { automationId }, body });
    }

    case 'cezar_delete_automation':
      return cezarApi(ENDPOINTS.deleteAutomation, {
        params: { automationId: asString(args.automationId, 'automationId') },
      });

    case 'cezar_enable_automation': {
      // Enable and pause are separate routes; neither reads a body.
      const endpoint = args.enabled === false ? ENDPOINTS.pauseAutomation : ENDPOINTS.enableAutomation;
      return cezarApi(endpoint, {
        params: { automationId: asString(args.automationId, 'automationId') },
      });
    }

    case 'cezar_run_automation':
      return cezarApi(ENDPOINTS.runAutomation, {
        params: { automationId: asString(args.automationId, 'automationId') },
      });

    // ======================================================================
    // DASHBOARD
    // ======================================================================
    case 'cezar_get_dashboard':
      return cezarApi(ENDPOINTS.dashboard);

    case 'cezar_get_usage_stats':
      return cezarApi(ENDPOINTS.dashboardOverview, {
        query: { period: typeof args.period === 'string' ? args.period : undefined },
      });

    case 'cezar_get_cost_stats':
      return cezarApi(ENDPOINTS.dashboardCosts, {
        query: {
          period: typeof args.period === 'string' ? args.period : undefined,
          sort: typeof args.sort === 'string' ? args.sort : undefined,
        },
      });

    case 'cezar_get_insights':
      return cezarApi(ENDPOINTS.dashboardInsights, {
        query: { period: typeof args.period === 'string' ? args.period : undefined },
      });

    case 'cezar_get_workspace_runs':
      return cezarApi(ENDPOINTS.runsIndex);

    // ======================================================================
    // GIT & REPO
    // ======================================================================
    case 'cezar_get_repo_info': {
      const repo = (await cezarApi(ENDPOINTS.repo)) as Record<string, unknown>;
      return { info: repo.info, baseBranch: repo.baseBranch, log: repo.log };
    }

    case 'cezar_get_repo_status': {
      const repo = (await cezarApi(ENDPOINTS.repo)) as Record<string, unknown>;
      return { info: repo.info, status: repo.status };
    }

    case 'cezar_get_branches': {
      const repo = (await cezarApi(ENDPOINTS.repo)) as Record<string, unknown>;
      return repo.branches;
    }

    case 'cezar_get_repo_tree':
      return cezarApi(ENDPOINTS.repoTree);

    case 'cezar_list_repo_files':
      return cezarApi(ENDPOINTS.repoFile, {
        query: { path: asString(args.path, 'path'), raw: args.raw === true ? '1' : undefined },
      });

    // Answers `text/plain` (a raw patch), so `cezarApi` hands back the string.
    case 'cezar_get_repo_diff':
      return cezarApi(ENDPOINTS.repoDiff);

    case 'cezar_get_repo_changes':
      return cezarApi(ENDPOINTS.repoChanges);

    case 'cezar_get_repo_commit':
      return cezarApi(ENDPOINTS.repoCommit, {
        params: { sha: asString(args.sha, 'sha') },
        // The route reads `?structured=1` and falls back to the text blob otherwise.
        query: { structured: args.structured === true ? '1' : undefined },
      });

    case 'cezar_create_repo_branch': {
      const body: Record<string, unknown> = { name: asString(args.name, 'name') };
      if (args.from !== undefined) body.from = args.from;
      return cezarApi(ENDPOINTS.repoBranch, { body });
    }

    // ======================================================================
    // AGENT CONFIG & PROFILES
    // ======================================================================
    case 'cezar_list_agent_configs':
      return cezarApi(ENDPOINTS.agentConfig);

    case 'cezar_list_agent_profiles':
      return cezarApi(ENDPOINTS.agentProfiles);

    case 'cezar_list_models':
      return cezarApi(ENDPOINTS.models, { query: { runner: asString(args.runner, 'runner') } });

    // ======================================================================
    // SYSTEM
    // ======================================================================
    case 'cezar_get_health':
      return cezarApi(ENDPOINTS.health);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

async function main() {
  const server = new Server(
    { name: 'cezar-mcp-server', version: '0.14.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await handleToolCall(request.params.name, request.params.arguments ?? {});
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
      const text = await readResource(request.params.uri);
      return { contents: [{ uri: request.params.uri, mimeType: 'application/json', text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read resource: ${message}`);
    }
  });

  await server.connect(new StdioServerTransport());

  // stderr, never stdout — stdout is the stdio protocol.
  console.error('cezar MCP server running');
  console.error(`Cockpit: ${CEZAR_URL}`);
  console.error(`Project: ${PROJECT_ID}`);
  console.error(`Tools: ${TOOLS.length} · resources: ${RESOURCES.length}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
