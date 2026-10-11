# Couverture — les 63 outils MCP

Ce fichier est la liste des outils exposés par `src/index.ts`, engendrée à partir de la source.
`packages/cezar/src/server/mcp-endpoint-drift.test.ts` tient le **côté routes** honnête : chaque
entrée de `src/endpoints.ts` doit correspondre à une route qu'une app construite enregistre, et une
entrée que plus aucun outil n'appelle fait échouer le test. Le nombre d'outils lui-même n'est pas
asserté — il est relu ici depuis la source quand elle change.

| Catégorie | Outils |
| --- | --- |
| TASKS | 22 |
| VARIANTS | 2 |
| WORKFLOWS | 5 |
| SKILLS | 2 |
| PROJECTS | 5 |
| FORGE | 4 |
| TRACKERS | 4 |
| AUTOMATIONS | 7 |
| DASHBOARD & INSIGHTS | 5 |
| GIT & REPO | 3 |
| AGENT CONFIG & PROFILES | 3 |
| SYSTEM | 1 |
| **TOTAL** | **63** |

## Ce qui n'est pas exposé, et pourquoi

L'API cezar ne propose pas ces surfaces, donc aucun outil MCP ne peut les couvrir :

- **Écriture de skills.** Les skills sont des fichiers `.md` que l'utilisateur écrit ; il n'existe
  aucune route `PUT/DELETE /skills/:name`. Le catalogue est en lecture seule (`GET /skills`).
- **Association tracker ↔ tâche.** Elle est au niveau du projet, pas de la tâche.
- **Streaming temps réel.** Le protocole MCP n'est pas poussé ici : un client interroge.
- **Upload binaire.** Pas de pièce jointe via MCP.
- **Brouillons (drafts), self-update, édition distante de la config agents** — hors périmètre.

## Les outils

### TASKS

- **`cezar_create_task`** — Create a new coding task. Supports variants (×2/×3), autonomous mode, a custom workflow or an inline step list, dispatch delegation and queue-only mode.
- **`cezar_list_tasks`** — List tasks with filtering. Returns ids, titles, statuses, branches, costs and metadata.
- **`cezar_get_task`** — Get detailed task information including steps, usage, tokens, cost and current state.
- **`cezar_edit_task`** — Edit a task title, or its prompt while the task is still queued.
- **`cezar_delete_task`** — Delete a finished task (done/failed/cancelled). Active tasks must be cancelled first.
- **`cezar_archive_task`** — Archive or unarchive a task.
- **`cezar_pin_task`** — Pin or unpin a task (pinned tasks sort to the top of the list).
- **`cezar_mark_task_read`** — Mark a task as read or unread.
- **`cezar_archive_all_finished`** — Archive every finished task (done/failed/cancelled) in the current project.
- **`cezar_mark_all_read`** — Mark all finished tasks as read.
- **`cezar_send_message`** — Send a message to a waiting or running task.
- **`cezar_cancel_task`** — Cancel a running or queued task.
- **`cezar_finish_task`** — Manually finish a running task (force completion).
- **`cezar_continue_task`** — Continue/resume a finished task, optionally with a new instruction.
- **`cezar_cancel_auto_resume`** — Cancel a pending automatic resume (scheduled after a usage limit).
- **`cezar_get_task_diff`** — Get the git diff a task produced (its worktree against its base branch), as raw diff text.
- **`cezar_get_task_commits`** — List the commits a task made.
- **`cezar_get_task_changes`** — Get detailed file changes (added/modified/deleted, with per-file diffs).
- **`cezar_commit_task`** — Create a git commit in the task worktree (git add -A && git commit).
- **`cezar_push_task`** — Push the task branch to its remote (sets upstream when needed).
- **`cezar_create_pr`** — Create a draft pull request for the task.
- **`cezar_remove_worktree`** — Remove a task worktree directory (keeps the branch).

### VARIANTS (×2, ×3)

- **`cezar_get_variants`** — Get every variant of a task group (the ×2/×3 siblings).
- **`cezar_pick_variant`** — Pick the winning variant (cancels the others, archives them and removes their worktrees).

### WORKFLOWS

- **`cezar_list_workflows`** — List all available workflows (built-in and saved), plus any files that failed to load.
- **`cezar_get_workflow`** — Get one workflow definition (steps, checks, skills) by name.
- **`cezar_create_workflow`** — Save a workflow as `.ai/cezar/workflows/<slug>.yaml`. Provide either `steps` or the portable `skills` shorthand, not both.
- **`cezar_update_workflow`** — Overwrite an existing saved workflow. Same body as create, with overwrite forced on.
- **`cezar_delete_workflow`** — Delete a saved workflow (built-ins have no file and cannot be deleted).

### SKILLS (read-only over HTTP)

- **`cezar_list_skills`** — List all available skills (markdown playbooks for agents).
- **`cezar_get_skill`** — Get one skill (markdown body plus its source and path).

### PROJECTS (multi-repo workspace)

- **`cezar_list_projects`** — List every project in the workspace.
- **`cezar_get_project`** — Get one project’s registry entry and status.
- **`cezar_add_project`** — Register an existing folder as a project in the workspace.
- **`cezar_remove_project`** — Remove a project from the workspace.
- **`cezar_update_project`** — Update a project’s workspace metadata. Only tags and maxParallel are editable — the display name is derived from the folder.

### FORGE (GitHub and other forges)

- **`cezar_list_github_issues`** — List the open issues of the project’s forge repository.
- **`cezar_list_github_prs`** — List the open pull requests of the project’s forge repository.
- **`cezar_search_github`** — Search issues and/or pull requests in ANY state (the list routes return the open set only).
- **`cezar_get_github_ref_status`** — Get the status of a pull request or issue reference.

### TRACKERS (Jira, Linear)

- **`cezar_list_tracker_items`** — List items from the connected issue tracker (Jira, Linear).
- **`cezar_search_tracker`** — Search the connected issue tracker (tracker-specific query syntax).
- **`cezar_get_tracker_item`** — Get one item from the connected issue tracker.
- **`cezar_get_tracker_connection`** — Get the current tracker connection (provider, scope, association).

### AUTOMATIONS

- **`cezar_list_automations`** — List all automations (forge events, tracker events, schedules) with their runtime state.
- **`cezar_get_automation`** — Get one automation’s definition and runtime state.
- **`cezar_create_automation`** — Create an automation. `kind` defaults to github; a github automation needs `events` + `intervalSeconds` + `filters`, a schedule needs `schedule`, a tracker automation needs `trackerTrigger`. It is created paused unless `enable` is true.
- **`cezar_update_automation`** — Update an automation. The current revision is read first and echoed back, so a concurrent edit is refused rather than overwritten.
- **`cezar_delete_automation`** — Delete an automation.
- **`cezar_enable_automation`** — Enable or pause an automation.
- **`cezar_run_automation`** — Trigger an automation once, now, by hand.

### DASHBOARD & INSIGHTS

- **`cezar_get_dashboard`** — Get the workspace dashboard (tasks needing attention, running, recent).
- **`cezar_get_usage_stats`** — Get the workspace outcome overview: delivered/failed tasks and per-project metrics.
- **`cezar_get_cost_stats`** — Get token and cost statistics by project and backend.
- **`cezar_get_insights`** — Get workspace insights (delivery, failure categories, backend and automation stats).
- **`cezar_get_workspace_runs`** — Get recent tasks across every project in the workspace.

### GIT & REPO

- **`cezar_get_repo_info`** — Get repository information (root, remote, base branch, commit log).
- **`cezar_get_repo_status`** — Get git status for the project working tree (modified/untracked files, branch).
- **`cezar_get_branches`** — List the git branches of the project.

### AGENT CONFIG & PROFILES

- **`cezar_list_agent_configs`** — List the coding agents’ own config files (Claude, Codex, OpenCode settings, MCP, memory).
- **`cezar_list_agent_profiles`** — List agent account profiles.
- **`cezar_list_models`** — List the models discovered for one backend.

### SYSTEM

- **`cezar_get_health`** — Get server health, capabilities and the available agents.
