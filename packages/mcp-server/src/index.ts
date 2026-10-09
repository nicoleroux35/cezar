#!/usr/bin/env node
// @ts-nocheck - TODO: Install @types/node dependency
/**
 * MCP Server for cezar — COMPLETE API coverage via Model Context Protocol.
 *
 * This server exposes ALL cezar capabilities to MCP clients (Claude Desktop, Cline, etc.):
 * - Task management (create, edit, delete, archive, pin, continue, etc.)
 * - Multi-project workspace management
 * - Workflows and skills (CRUD operations)
 * - GitHub integration (issues, PRs, draft PR creation)
 * - Issue tracker integration (Jira, Linear)
 * - Automations (create, manage, schedule)
 * - Git operations (commit, push, branches, worktrees)
 * - Variants (×2, ×3, compare, pick)
 * - Dashboard and insights
 * - Agent configuration and profiles
 * - Real-time events and monitoring
 * 
 * Usage:
 *   cezar-mcp [--project-id ID]
 * 
 * The server connects to a running cezar instance (default: http://127.0.0.1:5192).
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

// Configuration
const DEFAULT_CEZAR_URL = 'http://127.0.0.1:5192';
const CEZAR_URL = process.env.CEZAR_URL || DEFAULT_CEZAR_URL;
const PROJECT_ID = process.env.CEZAR_PROJECT_ID || 'default';

// Simple fetch wrapper for cezar API
async function cezarApi(path: string, options?: RequestInit) {
  const url = `${CEZAR_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Cezar API error (${response.status}): ${text}`);
  }

  return response.json();
}

// Helper for DELETE requests
async function cezarApiDelete(path: string) {
  return cezarApi(path, { method: 'DELETE' });
}

// Helper for PATCH requests
async function cezarApiPatch(path: string, body: any) {
  return cezarApi(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// Helper for PUT requests
async function cezarApiPut(path: string, body: any) {
  return cezarApi(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

// Tool definitions - organized by category
const TOOLS: Tool[] = [
  // ============================================================================
  // TASKS - Basic operations (existing + enhanced)
  // ============================================================================
  {
    name: 'cezar_create_task',
    description: 'Create a new coding task. Supports variants (×2, ×3), autonomous mode, custom workflows, and dispatch.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task description/prompt for the agent' },
        workflow: { type: 'string', description: 'Workflow name (default: quick-task)' },
        runner: { type: 'string', enum: ['claude', 'codex', 'opencode', 'cursor', 'junie'], description: 'Agent backend' },
        model: { type: 'string', description: 'Specific model to use' },
        autonomous: { type: 'boolean', description: 'Run without review gates' },
        variants: { type: 'number', enum: [1, 2, 3], description: 'Number of parallel variants (default: 1)' },
        worktree: { type: 'boolean', description: 'Use isolated worktree (default: true)' },
        systemPrompt: { type: 'string', description: 'Custom system prompt' },
        dispatch: { type: 'boolean', description: 'Enable task dispatch (delegation)' },
      },
      required: ['task'],
    },
  },
  {
    name: 'cezar_list_tasks',
    description: 'List tasks with filtering. Returns IDs, titles, statuses, branches, costs, and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['queued', 'running', 'waiting', 'review', 'done', 'failed', 'cancelled'] },
        limit: { type: 'number', description: 'Maximum results' },
        archived: { type: 'boolean', description: 'Include archived tasks' },
      },
    },
  },
  {
    name: 'cezar_get_task',
    description: 'Get detailed task information including steps, usage, tokens, cost, and current state.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_edit_task',
    description: 'Edit task title or initial prompt (prompt only editable while queued).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        title: { type: 'string', description: 'New title (1-300 chars)' },
        task: { type: 'string', description: 'New prompt (only if queued)' },
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
    description: 'Archive a task (move to archived list).',
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
    description: 'Pin/unpin a task to the top of the task list.',
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
    description: 'Archive all finished tasks (done/failed/cancelled) in the current project.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_mark_all_read',
    description: 'Mark all finished tasks as read.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ============================================================================
  // TASKS - Lifecycle operations
  // ============================================================================
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
    description: 'Continue/resume a finished task with a new prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        message: { type: 'string', description: 'Optional message to continue with' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_cancel_auto_resume',
    description: 'Cancel a pending automatic resume (after usage limit).',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },

  // ============================================================================
  // TASKS - Git operations
  // ============================================================================
  {
    name: 'cezar_get_task_diff',
    description: 'Get the git diff for a task (what changes the agent made).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        maxLines: { type: 'number', description: 'Max diff lines' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_get_task_commits',
    description: 'List all commits made by a task.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'cezar_get_task_changes',
    description: 'Get detailed file changes (files added/modified/deleted with diffs).',
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
    description: 'Push the task branch to remote (sets upstream if needed).',
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

  // ============================================================================
  // VARIANTS (×2, ×3)
  // ============================================================================
  {
    name: 'cezar_get_variants',
    description: 'Get all variants of a task group (for ×2 or ×3 tasks).',
    inputSchema: {
      type: 'object',
      properties: { groupId: { type: 'string', description: 'Group ID from the task' } },
      required: ['groupId'],
    },
  },
  {
    name: 'cezar_pick_variant',
    description: 'Pick the winning variant (cancels others, archives them, removes worktrees).',
    inputSchema: {
      type: 'object',
      properties: {
        groupId: { type: 'string' },
        winnerId: { type: 'string', description: 'Task ID of the winning variant' },
      },
      required: ['groupId', 'winnerId'],
    },
  },

  // ============================================================================
  // WORKFLOWS
  // ============================================================================
  {
    name: 'cezar_list_workflows',
    description: 'List all available workflows (built-in and custom).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_get_workflow',
    description: 'Get a workflow definition (steps, checks, skills).',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Workflow name' } },
      required: ['name'],
    },
  },
  {
    name: 'cezar_create_workflow',
    description: 'Create a new workflow (YAML definition).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Workflow name (will create .ai/cezar/workflows/<name>.yml)' },
        content: { type: 'string', description: 'YAML workflow definition' },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: 'cezar_update_workflow',
    description: 'Update an existing workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        content: { type: 'string', description: 'New YAML content' },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: 'cezar_delete_workflow',
    description: 'Delete a custom workflow (built-ins cannot be deleted).',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },

  // ============================================================================
  // SKILLS
  // ============================================================================
  {
    name: 'cezar_list_skills',
    description: 'List all available skills (markdown playbooks for agents).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_get_skill',
    description: 'Get a skill content (markdown + optional frontmatter).',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Skill name' } },
      required: ['name'],
    },
  },
  {
    name: 'cezar_create_skill',
    description: 'Create a new skill (markdown file).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name (will create .ai/cezar/skills/<name>.md)' },
        content: { type: 'string', description: 'Markdown content with optional YAML frontmatter' },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: 'cezar_update_skill',
    description: 'Update an existing skill.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: 'cezar_delete_skill',
    description: 'Delete a custom skill.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },

  // ============================================================================
  // PROJECTS (Multi-repo workspace)
  // ============================================================================
  {
    name: 'cezar_list_projects',
    description: 'List all projects in the workspace.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_get_project',
    description: 'Get project details and status.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'cezar_add_project',
    description: 'Add a project to the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the project root' },
        name: { type: 'string', description: 'Optional display name' },
      },
      required: ['path'],
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
    description: 'Update project metadata (name, tags).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        name: { type: 'string', description: 'New display name' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Project tags' },
      },
      required: ['projectId'],
    },
  },

  // ============================================================================
  // GITHUB
  // ============================================================================
  {
    name: 'cezar_list_github_issues',
    description: 'List GitHub issues for the project.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state filter' },
        limit: { type: 'number', description: 'Max results' },
      },
    },
  },
  {
    name: 'cezar_list_github_prs',
    description: 'List GitHub pull requests for the project.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['open', 'closed', 'merged', 'all'] },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'cezar_search_github',
    description: 'Search GitHub issues and PRs.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        type: { type: 'string', enum: ['issues', 'prs', 'all'], description: 'What to search' },
      },
      required: ['query'],
    },
  },
  {
    name: 'cezar_get_github_ref_status',
    description: 'Get status of a PR or issue reference.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['pr', 'issue'] },
        number: { type: 'number', description: 'PR or issue number' },
      },
      required: ['type', 'number'],
    },
  },

  // ============================================================================
  // TRACKERS (Jira, Linear)
  // ============================================================================
  {
    name: 'cezar_list_tracker_items',
    description: 'List items from connected issue tracker (Jira, Linear).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
    },
  },
  {
    name: 'cezar_search_tracker',
    description: 'Search in the connected issue tracker.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (tracker-specific syntax)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'cezar_get_tracker_item',
    description: 'Get details of a specific tracker item.',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: { type: 'string', description: 'Tracker item ID' },
      },
      required: ['itemId'],
    },
  },
  {
    name: 'cezar_associate_tracker_item',
    description: 'Associate a task with a tracker item.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        itemId: { type: 'string', description: 'Tracker item ID' },
      },
      required: ['taskId', 'itemId'],
    },
  },
  {
    name: 'cezar_get_tracker_connection',
    description: 'Get current tracker connection info.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ============================================================================
  // AUTOMATIONS
  // ============================================================================
  {
    name: 'cezar_list_automations',
    description: 'List all automations (GitHub events, tracker events, schedules).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_get_automation',
    description: 'Get automation details and history.',
    inputSchema: {
      type: 'object',
      properties: { automationId: { type: 'string' } },
      required: ['automationId'],
    },
  },
  {
    name: 'cezar_create_automation',
    description: 'Create a new automation.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Automation name' },
        type: { type: 'string', enum: ['github', 'tracker', 'schedule'], description: 'Automation type' },
        config: { type: 'object', description: 'Type-specific configuration' },
        task: { type: 'object', description: 'Task template' },
      },
      required: ['name', 'type', 'config', 'task'],
    },
  },
  {
    name: 'cezar_update_automation',
    description: 'Update an existing automation.',
    inputSchema: {
      type: 'object',
      properties: {
        automationId: { type: 'string' },
        updates: { type: 'object', description: 'Fields to update' },
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
    description: 'Enable/disable an automation.',
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
    description: 'Manually trigger an automation.',
    inputSchema: {
      type: 'object',
      properties: { automationId: { type: 'string' } },
      required: ['automationId'],
    },
  },

  // ============================================================================
  // DASHBOARD & INSIGHTS
  // ============================================================================
  {
    name: 'cezar_get_dashboard',
    description: 'Get workspace dashboard (tasks needing attention, running, recent).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_get_usage_stats',
    description: 'Get token usage statistics by project.',
    inputSchema: {
      type: 'object',
      properties: {
        timeRange: { type: 'string', enum: ['day', 'week', 'month', 'all'], description: 'Time range' },
      },
    },
  },
  {
    name: 'cezar_get_cost_stats',
    description: 'Get cost statistics by project and runner.',
    inputSchema: {
      type: 'object',
      properties: {
        timeRange: { type: 'string', enum: ['day', 'week', 'month', 'all'] },
      },
    },
  },
  {
    name: 'cezar_get_insights',
    description: 'Get insights (patterns, common failures, recommendations).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_get_workspace_runs',
    description: 'Get runs across all projects in workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
      },
    },
  },

  // ============================================================================
  // GIT & REPO
  // ============================================================================
  {
    name: 'cezar_get_branches',
    description: 'List git branches in the project.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_get_repo_status',
    description: 'Get git status (modified files, branch, etc.).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_get_repo_info',
    description: 'Get repository information (remote, default branch, etc.).',
    inputSchema: { type: 'object', properties: {} },
  },

  // ============================================================================
  // AGENT CONFIG & PROFILES
  // ============================================================================
  {
    name: 'cezar_list_agent_configs',
    description: 'List agent configuration files (Claude, Codex, OpenCode settings).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_list_agent_profiles',
    description: 'List agent account profiles.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cezar_list_models',
    description: 'List available models for each runner.',
    inputSchema: {
      type: 'object',
      properties: {
        runner: { type: 'string', enum: ['claude', 'codex', 'opencode', 'cursor', 'junie'] },
      },
    },
  },

  // ============================================================================
  // SYSTEM
  // ============================================================================
  {
    name: 'cezar_get_health',
    description: 'Get server health, capabilities, and available agents.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// Resource URIs
async function listResources(): Promise<Resource[]> {
  const resources: Resource[] = [
    // Tasks
    { uri: 'cezar://tasks', name: 'All Tasks', description: 'List of all tasks', mimeType: 'application/json' },
    { uri: 'cezar://tasks/active', name: 'Active Tasks', description: 'Running and queued tasks', mimeType: 'application/json' },
    { uri: 'cezar://tasks/needs-attention', name: 'Tasks Needing Attention', description: 'Waiting and review tasks', mimeType: 'application/json' },
    
    // Workflows & Skills
    { uri: 'cezar://workflows', name: 'Workflows', description: 'Available workflows', mimeType: 'application/json' },
    { uri: 'cezar://skills', name: 'Skills', description: 'Available skills', mimeType: 'application/json' },
    
    // Projects
    { uri: 'cezar://projects', name: 'Projects', description: 'Workspace projects', mimeType: 'application/json' },
    
    // Dashboard
    { uri: 'cezar://dashboard', name: 'Dashboard', description: 'Workspace overview', mimeType: 'application/json' },
    
    // GitHub
    { uri: 'cezar://github/issues', name: 'GitHub Issues', description: 'Open issues', mimeType: 'application/json' },
    { uri: 'cezar://github/prs', name: 'GitHub PRs', description: 'Open pull requests', mimeType: 'application/json' },
    
    // Automations
    { uri: 'cezar://automations', name: 'Automations', description: 'All automations', mimeType: 'application/json' },
    
    // System
    { uri: 'cezar://health', name: 'Server Health', description: 'Status and capabilities', mimeType: 'application/json' },
  ];

  return resources;
}

async function readResource(uri: string): Promise<string> {
  const url = new URL(uri);
  
  switch (url.pathname) {
    case '/tasks': {
      const runs = await cezarApi(`/api/v1/p/${PROJECT_ID}/runs`);
      return JSON.stringify(runs, null, 2);
    }
    case '/tasks/active': {
      const runs = await cezarApi(`/api/v1/p/${PROJECT_ID}/runs`);
      const active = (runs as any[]).filter((r: any) => 
        ['queued', 'running'].includes(r.status)
      );
      return JSON.stringify(active, null, 2);
    }
    case '/tasks/needs-attention': {
      const runs = await cezarApi(`/api/v1/p/${PROJECT_ID}/runs`);
      const needsAttention = (runs as any[]).filter((r: any) => 
        ['waiting', 'review'].includes(r.status)
      );
      return JSON.stringify(needsAttention, null, 2);
    }
    case '/workflows': {
      const workflows = await cezarApi(`/api/v1/p/${PROJECT_ID}/workflows`);
      return JSON.stringify(workflows, null, 2);
    }
    case '/skills': {
      const skills = await cezarApi(`/api/v1/p/${PROJECT_ID}/skills`);
      return JSON.stringify(skills, null, 2);
    }
    case '/projects': {
      const projects = await cezarApi('/api/v1/projects');
      return JSON.stringify(projects, null, 2);
    }
    case '/dashboard': {
      const dashboard = await cezarApi('/api/v1/workspace/dashboard');
      return JSON.stringify(dashboard, null, 2);
    }
    case '/github/issues': {
      const issues = await cezarApi(`/api/v1/p/${PROJECT_ID}/github/issues?state=open`);
      return JSON.stringify(issues, null, 2);
    }
    case '/github/prs': {
      const prs = await cezarApi(`/api/v1/p/${PROJECT_ID}/github/prs?state=open`);
      return JSON.stringify(prs, null, 2);
    }
    case '/automations': {
      const automations = await cezarApi(`/api/v1/p/${PROJECT_ID}/automations`);
      return JSON.stringify(automations, null, 2);
    }
    case '/health': {
      const health = await cezarApi('/api/v1/health');
      return JSON.stringify(health, null, 2);
    }
    default: {
      // Task-specific resource: cezar://tasks/TASK_ID
      const match = url.pathname.match(/^\/tasks\/(.+)$/);
      if (match) {
        const taskId = match[1];
        const task = await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/${taskId}`);
        return JSON.stringify(task, null, 2);
      }
      throw new Error(`Unknown resource: ${uri}`);
    }
  }
}

// Tool handlers - COMPLETE IMPLEMENTATION
async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    // ========================================================================
    // TASKS - Basic operations
    // ========================================================================
    case 'cezar_create_task': {
      const body: any = {
        task: args.task as string,
        workflow: args.workflow as string | undefined,
        runner: args.runner as string | undefined,
        model: args.model as string | undefined,
        autonomous: args.autonomous as boolean | undefined,
        variants: args.variants as number | undefined,
        worktree: args.worktree as boolean | undefined,
        systemPrompt: args.systemPrompt as string | undefined,
      };
      if (args.dispatch) {
        body.dispatch = { enabled: true };
      }
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/runs`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    }

    case 'cezar_list_tasks': {
      const runs = await cezarApi(`/api/v1/p/${PROJECT_ID}/runs`);
      let filtered = runs as any[];
      if (args.status) {
        filtered = filtered.filter((r: any) => r.status === args.status);
      }
      if (!args.archived) {
        filtered = filtered.filter((r: any) => !r.archived);
      }
      if (args.limit) {
        filtered = filtered.slice(0, args.limit as number);
      }
      return filtered;
    }

    case 'cezar_get_task': {
      const taskId = args.taskId as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/${taskId}`);
    }

    case 'cezar_edit_task': {
      const taskId = args.taskId as string;
      const body: any = {};
      if (args.title) body.title = args.title;
      if (args.task) body.task = args.task;
      return await cezarApiPatch(`/api/v1/p/${PROJECT_ID}/runs/${taskId}`, body);
    }

    case 'cezar_delete_task': {
      const taskId = args.taskId as string;
      return await cezarApiDelete(`/api/v1/p/${PROJECT_ID}/runs/${taskId}`);
    }

    case 'cezar_archive_task': {
      const taskId = args.taskId as string;
      const archived = args.archived as boolean;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/${taskId}/archive`, {
        method: 'POST',
        body: JSON.stringify({ archived }),
      });
    }

    case 'cezar_pin_task': {
      const taskId = args.taskId as string;
      const pinned = args.pinned as boolean;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/${taskId}/pin`, {
        method: 'POST',
        body: JSON.stringify({ pinned }),
      });
    }

    case 'cezar_mark_task_read': {
      const taskId = args.taskId as string;
      const endpoint = args.unread 
        ? `/api/v1/p/${PROJECT_ID}/runs/${taskId}/unread`
        : `/api/v1/p/${PROJECT_ID}/runs/${taskId}/read`;
      return await cezarApi(endpoint, { method: 'POST' });
    }

    case 'cezar_archive_all_finished': {
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/archive-finished`, {
        method: 'POST',
      });
    }

    case 'cezar_mark_all_read': {
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/read-all`, {
        method: 'POST',
      });
    }

    // ========================================================================
    // TASKS - Lifecycle
    // ========================================================================
    case 'cezar_send_message': {
      const taskId = args.taskId as string;
      const text = args.text as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/${taskId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
    }

    case 'cezar_cancel_task': {
      const taskId = args.taskId as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/${taskId}/cancel`, {
        method: 'POST',
      });
    }

    case 'cezar_finish_task': {
      const taskId = args.taskId as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/${taskId}/finish`, {
        method: 'POST',
      });
    }

    case 'cezar_continue_task': {
      const taskId = args.taskId as string;
      const body: any = {};
      if (args.message) body.message = args.message;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/${taskId}/continue`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    }

    case 'cezar_cancel_auto_resume': {
      const taskId = args.taskId as string;
      return await cezarApiDelete(`/api/v1/p/${PROJECT_ID}/runs/${taskId}/auto-resume`);
    }

    // ========================================================================
    // TASKS - Git operations
    // ========================================================================
    case 'cezar_get_task_diff': {
      const taskId = args.taskId as string;
      const maxLines = args.maxLines as number | undefined;
      const query = maxLines ? `?maxLines=${maxLines}` : '';
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/${taskId}/diff${query}`);
    }

    case 'cezar_get_task_commits': {
      const taskId = args.taskId as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/${taskId}/commits`);
    }

    case 'cezar_get_task_changes': {
      const taskId = args.taskId as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/${taskId}/changes`);
    }

    case 'cezar_commit_task': {
      const taskId = args.taskId as string;
      const message = args.message as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/${taskId}/git/commit`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
    }

    case 'cezar_push_task': {
      const taskId = args.taskId as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/${taskId}/git/push`, {
        method: 'POST',
      });
    }

    case 'cezar_create_pr': {
      const taskId = args.taskId as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/${taskId}/pr`, {
        method: 'POST',
      });
    }

    case 'cezar_remove_worktree': {
      const taskId = args.taskId as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/${taskId}/remove-worktree`, {
        method: 'POST',
      });
    }

    // ========================================================================
    // VARIANTS
    // ========================================================================
    case 'cezar_get_variants': {
      const groupId = args.groupId as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/groups/${groupId}`);
    }

    case 'cezar_pick_variant': {
      const groupId = args.groupId as string;
      const winnerId = args.winnerId as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/groups/${groupId}/pick`, {
        method: 'POST',
        body: JSON.stringify({ winnerId }),
      });
    }

    // ========================================================================
    // WORKFLOWS
    // ========================================================================
    case 'cezar_list_workflows': {
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/workflows`);
    }

    case 'cezar_get_workflow': {
      const name = args.name as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/workflows/${encodeURIComponent(name)}`);
    }

    case 'cezar_create_workflow': {
      const name = args.name as string;
      const content = args.content as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/workflows/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: JSON.stringify({ content }),
      });
    }

    case 'cezar_update_workflow': {
      const name = args.name as string;
      const content = args.content as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/workflows/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: JSON.stringify({ content }),
      });
    }

    case 'cezar_delete_workflow': {
      const name = args.name as string;
      return await cezarApiDelete(`/api/v1/p/${PROJECT_ID}/workflows/${encodeURIComponent(name)}`);
    }

    // ========================================================================
    // SKILLS
    // ========================================================================
    case 'cezar_list_skills': {
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/skills`);
    }

    case 'cezar_get_skill': {
      const name = args.name as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/skills/${encodeURIComponent(name)}`);
    }

    case 'cezar_create_skill': {
      const name = args.name as string;
      const content = args.content as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/skills/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: JSON.stringify({ content }),
      });
    }

    case 'cezar_update_skill': {
      const name = args.name as string;
      const content = args.content as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/skills/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: JSON.stringify({ content }),
      });
    }

    case 'cezar_delete_skill': {
      const name = args.name as string;
      return await cezarApiDelete(`/api/v1/p/${PROJECT_ID}/skills/${encodeURIComponent(name)}`);
    }

    // ========================================================================
    // PROJECTS
    // ========================================================================
    case 'cezar_list_projects': {
      return await cezarApi('/api/v1/projects');
    }

    case 'cezar_get_project': {
      const projectId = args.projectId as string;
      return await cezarApi(`/api/v1/projects/${projectId}`);
    }

    case 'cezar_add_project': {
      const path = args.path as string;
      const name = args.name as string | undefined;
      return await cezarApi('/api/v1/projects', {
        method: 'POST',
        body: JSON.stringify({ path, name }),
      });
    }

    case 'cezar_remove_project': {
      const projectId = args.projectId as string;
      return await cezarApiDelete(`/api/v1/projects/${projectId}`);
    }

    case 'cezar_update_project': {
      const projectId = args.projectId as string;
      const updates: any = {};
      if (args.name) updates.name = args.name;
      if (args.tags) updates.tags = args.tags;
      return await cezarApiPatch(`/api/v1/projects/${projectId}`, updates);
    }

    // ========================================================================
    // GITHUB
    // ========================================================================
    case 'cezar_list_github_issues': {
      const state = (args.state as string) || 'open';
      const limit = args.limit as number | undefined;
      const query = limit ? `?state=${state}&limit=${limit}` : `?state=${state}`;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/github/issues${query}`);
    }

    case 'cezar_list_github_prs': {
      const state = (args.state as string) || 'open';
      const limit = args.limit as number | undefined;
      const query = limit ? `?state=${state}&limit=${limit}` : `?state=${state}`;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/github/prs${query}`);
    }

    case 'cezar_search_github': {
      const query = args.query as string;
      const type = (args.type as string) || 'all';
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/github/search?q=${encodeURIComponent(query)}&type=${type}`);
    }

    case 'cezar_get_github_ref_status': {
      const type = args.type as string;
      const number = args.number as number;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/github/ref-status?type=${type}&number=${number}`);
    }

    // ========================================================================
    // TRACKERS
    // ========================================================================
    case 'cezar_list_tracker_items': {
      const limit = args.limit as number | undefined;
      const offset = args.offset as number | undefined;
      let query = '';
      if (limit || offset) {
        const params = new URLSearchParams();
        if (limit) params.set('limit', String(limit));
        if (offset) params.set('offset', String(offset));
        query = `?${params}`;
      }
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/tracker/items${query}`);
    }

    case 'cezar_search_tracker': {
      const query = args.query as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/tracker/search?q=${encodeURIComponent(query)}`);
    }

    case 'cezar_get_tracker_item': {
      const itemId = args.itemId as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/tracker/items/${encodeURIComponent(itemId)}`);
    }

    case 'cezar_associate_tracker_item': {
      const taskId = args.taskId as string;
      const itemId = args.itemId as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/${taskId}/tracker`, {
        method: 'POST',
        body: JSON.stringify({ itemId }),
      });
    }

    case 'cezar_get_tracker_connection': {
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/tracker/connection`);
    }

    // ========================================================================
    // AUTOMATIONS
    // ========================================================================
    case 'cezar_list_automations': {
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/automations`);
    }

    case 'cezar_get_automation': {
      const automationId = args.automationId as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/automations/${automationId}`);
    }

    case 'cezar_create_automation': {
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/automations`, {
        method: 'POST',
        body: JSON.stringify(args),
      });
    }

    case 'cezar_update_automation': {
      const automationId = args.automationId as string;
      const updates = args.updates as any;
      return await cezarApiPatch(`/api/v1/p/${PROJECT_ID}/automations/${automationId}`, updates);
    }

    case 'cezar_delete_automation': {
      const automationId = args.automationId as string;
      return await cezarApiDelete(`/api/v1/p/${PROJECT_ID}/automations/${automationId}`);
    }

    case 'cezar_enable_automation': {
      const automationId = args.automationId as string;
      const enabled = args.enabled as boolean;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/automations/${automationId}/enable`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
    }

    case 'cezar_run_automation': {
      const automationId = args.automationId as string;
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/automations/${automationId}/run`, {
        method: 'POST',
      });
    }

    // ========================================================================
    // DASHBOARD & INSIGHTS
    // ========================================================================
    case 'cezar_get_dashboard': {
      return await cezarApi('/api/v1/workspace/dashboard');
    }

    case 'cezar_get_usage_stats': {
      const timeRange = (args.timeRange as string) || 'week';
      return await cezarApi(`/api/v1/dashboard/usage?range=${timeRange}`);
    }

    case 'cezar_get_cost_stats': {
      const timeRange = (args.timeRange as string) || 'week';
      return await cezarApi(`/api/v1/dashboard/costs?range=${timeRange}`);
    }

    case 'cezar_get_insights': {
      return await cezarApi('/api/v1/dashboard/insights');
    }

    case 'cezar_get_workspace_runs': {
      const limit = args.limit as number | undefined;
      const query = limit ? `?limit=${limit}` : '';
      return await cezarApi(`/api/v1/workspace/runs-index${query}`);
    }

    // ========================================================================
    // GIT & REPO
    // ========================================================================
    case 'cezar_get_branches': {
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/git/branches`);
    }

    case 'cezar_get_repo_status': {
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/git/status`);
    }

    case 'cezar_get_repo_info': {
      return await cezarApi(`/api/v1/p/${PROJECT_ID}/repo/info`);
    }

    // ========================================================================
    // AGENT CONFIG & PROFILES
    // ========================================================================
    case 'cezar_list_agent_configs': {
      return await cezarApi('/api/v1/agent-config');
    }

    case 'cezar_list_agent_profiles': {
      return await cezarApi('/api/v1/agent-profiles');
    }

    case 'cezar_list_models': {
      const runner = args.runner as string | undefined;
      const query = runner ? `?runner=${runner}` : '';
      return await cezarApi(`/api/v1/models${query}`);
    }

    // ========================================================================
    // SYSTEM
    // ========================================================================
    case 'cezar_get_health': {
      return await cezarApi('/api/v1/health');
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Main server setup
async function main() {
  const server = new Server(
    {
      name: 'cezar-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await handleToolCall(request.params.name, request.params.arguments || {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // List available resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = await listResources();
    return { resources };
  });

  // Read resource
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
      const content = await readResource(request.params.uri);
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: 'application/json',
            text: content,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read resource: ${message}`);
    }
  });

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with stdio protocol
  console.error('Cezar MCP server running (COMPLETE API)');
  console.error(`Connected to: ${CEZAR_URL}`);
  console.error(`Project ID: ${PROJECT_ID}`);
  console.error(`Tools exposed: ${TOOLS.length}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
