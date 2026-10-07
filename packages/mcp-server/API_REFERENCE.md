# Référence rapide des outils MCP Cezar

## 📋 Tâches - Opérations basiques

| Outil | Description | Paramètres requis |
|-------|-------------|-------------------|
| `cezar_create_task` | Créer une tâche | `task` |
| `cezar_list_tasks` | Lister les tâches | - |
| `cezar_get_task` | Détails d'une tâche | `taskId` |
| `cezar_edit_task` | Éditer titre/prompt | `taskId` |
| `cezar_delete_task` | Supprimer une tâche | `taskId` |
| `cezar_archive_task` | Archiver/désarchiver | `taskId`, `archived` |
| `cezar_pin_task` | Épingler/désépingler | `taskId`, `pinned` |
| `cezar_mark_task_read` | Marquer lu/non-lu | `taskId` |
| `cezar_archive_all_finished` | Archiver toutes les terminées | - |
| `cezar_mark_all_read` | Tout marquer lu | - |

## 🔄 Tâches - Cycle de vie

| Outil | Description | Paramètres requis |
|-------|-------------|-------------------|
| `cezar_send_message` | Envoyer un message | `taskId`, `text` |
| `cezar_cancel_task` | Annuler | `taskId` |
| `cezar_finish_task` | Finir manuellement | `taskId` |
| `cezar_continue_task` | Continuer/reprendre | `taskId` |
| `cezar_cancel_auto_resume` | Annuler reprise auto | `taskId` |

## 🌳 Tâches - Git

| Outil | Description | Paramètres requis |
|-------|-------------|-------------------|
| `cezar_get_task_diff` | Obtenir le diff | `taskId` |
| `cezar_get_task_commits` | Lister commits | `taskId` |
| `cezar_get_task_changes` | Changements par fichier | `taskId` |
| `cezar_commit_task` | Créer commit | `taskId`, `message` |
| `cezar_push_task` | Pousser vers remote | `taskId` |
| `cezar_create_pr` | Créer draft PR | `taskId` |
| `cezar_remove_worktree` | Supprimer worktree | `taskId` |

## 🔀 Variantes

| Outil | Description | Paramètres requis |
|-------|-------------|-------------------|
| `cezar_get_variants` | Lister variantes groupe | `groupId` |
| `cezar_pick_variant` | Choisir gagnant | `groupId`, `winnerId` |

## 📝 Workflows

| Outil | Description | Paramètres requis |
|-------|-------------|-------------------|
| `cezar_list_workflows` | Lister workflows | - |
| `cezar_get_workflow` | Obtenir définition | `name` |
| `cezar_create_workflow` | Créer workflow | `name`, `content` |
| `cezar_update_workflow` | Modifier workflow | `name`, `content` |
| `cezar_delete_workflow` | Supprimer workflow | `name` |

## 🎯 Skills

| Outil | Description | Paramètres requis |
|-------|-------------|-------------------|
| `cezar_list_skills` | Lister skills | - |
| `cezar_get_skill` | Obtenir contenu | `name` |
| `cezar_create_skill` | Créer skill | `name`, `content` |
| `cezar_update_skill` | Modifier skill | `name`, `content` |
| `cezar_delete_skill` | Supprimer skill | `name` |

## 📂 Projets

| Outil | Description | Paramètres requis |
|-------|-------------|-------------------|
| `cezar_list_projects` | Lister projets | - |
| `cezar_get_project` | Détails projet | `projectId` |
| `cezar_add_project` | Ajouter projet | `path` |
| `cezar_remove_project` | Retirer projet | `projectId` |
| `cezar_update_project` | Modifier projet | `projectId` |

## 🐙 GitHub

| Outil | Description | Paramètres requis |
|-------|-------------|-------------------|
| `cezar_list_github_issues` | Lister issues | - |
| `cezar_list_github_prs` | Lister PRs | - |
| `cezar_search_github` | Rechercher | `query` |
| `cezar_get_github_ref_status` | Statut référence | `type`, `number` |

## 🎫 Trackers

| Outil | Description | Paramètres requis |
|-------|-------------|-------------------|
| `cezar_list_tracker_items` | Lister items | - |
| `cezar_search_tracker` | Rechercher | `query` |
| `cezar_get_tracker_item` | Détails item | `itemId` |
| `cezar_associate_tracker_item` | Associer à tâche | `taskId`, `itemId` |
| `cezar_get_tracker_connection` | Info connexion | - |

## ⏰ Automations

| Outil | Description | Paramètres requis |
|-------|-------------|-------------------|
| `cezar_list_automations` | Lister automations | - |
| `cezar_get_automation` | Détails automation | `automationId` |
| `cezar_create_automation` | Créer automation | `name`, `type`, `config`, `task` |
| `cezar_update_automation` | Modifier automation | `automationId`, `updates` |
| `cezar_delete_automation` | Supprimer automation | `automationId` |
| `cezar_enable_automation` | Activer/désactiver | `automationId`, `enabled` |
| `cezar_run_automation` | Lancer manuellement | `automationId` |

## 📊 Dashboard

| Outil | Description | Paramètres requis |
|-------|-------------|-------------------|
| `cezar_get_dashboard` | Vue d'ensemble | - |
| `cezar_get_usage_stats` | Stats usage | - |
| `cezar_get_cost_stats` | Stats coûts | - |
| `cezar_get_insights` | Insights | - |
| `cezar_get_workspace_runs` | Tâches cross-projets | - |

## 🌳 Git & Repo

| Outil | Description | Paramètres requis |
|-------|-------------|-------------------|
| `cezar_get_branches` | Lister branches | - |
| `cezar_get_repo_status` | Statut git | - |
| `cezar_get_repo_info` | Info repo | - |

## 🔧 Config

| Outil | Description | Paramètres requis |
|-------|-------------|-------------------|
| `cezar_list_agent_configs` | Lister configs agents | - |
| `cezar_list_agent_profiles` | Lister profils | - |
| `cezar_list_models` | Lister modèles | - |

## 💻 Système

| Outil | Description | Paramètres requis |
|-------|-------------|-------------------|
| `cezar_get_health` | Santé serveur | - |

---

## Paramètres optionnels communs

### `cezar_create_task`
```typescript
{
  task: string,           // REQUIS
  workflow?: string,      // Défaut: "quick-task"
  runner?: string,        // claude|codex|opencode|cursor|junie
  model?: string,         // Modèle spécifique
  autonomous?: boolean,   // Mode autonome
  variants?: number,      // 1|2|3 (défaut: 1)
  worktree?: boolean,     // Défaut: true
  systemPrompt?: string,  // Prompt système custom
  dispatch?: boolean      // Délégation activée
}
```

### `cezar_list_tasks`
```typescript
{
  status?: string,   // queued|running|waiting|review|done|failed|cancelled
  limit?: number,    // Max résultats
  archived?: boolean // Inclure archivées
}
```

### `cezar_edit_task`
```typescript
{
  taskId: string,    // REQUIS
  title?: string,    // Nouveau titre
  task?: string      // Nouveau prompt (seulement si queued)
}
```

### `cezar_get_task_diff`
```typescript
{
  taskId: string,    // REQUIS
  maxLines?: number  // Max lignes de diff
}
```

### `cezar_list_github_issues`
```typescript
{
  state?: string,    // open|closed|all (défaut: open)
  limit?: number     // Max résultats
}
```

### `cezar_search_github`
```typescript
{
  query: string,     // REQUIS
  type?: string      // issues|prs|all (défaut: all)
}
```

### `cezar_get_usage_stats`
```typescript
{
  timeRange?: string // day|week|month|all (défaut: week)
}
```

---

## Ressources MCP

| URI | Description |
|-----|-------------|
| `cezar://tasks` | Toutes les tâches |
| `cezar://tasks/active` | Tâches actives |
| `cezar://tasks/needs-attention` | Besoin d'action |
| `cezar://tasks/{taskId}` | Détails tâche |
| `cezar://workflows` | Tous workflows |
| `cezar://skills` | Tous skills |
| `cezar://projects` | Tous projets |
| `cezar://dashboard` | Dashboard |
| `cezar://github/issues` | Issues ouvertes |
| `cezar://github/prs` | PRs ouvertes |
| `cezar://automations` | Automations |
| `cezar://health` | Santé serveur |

---

## Exemples rapides

### Tâche simple
```javascript
cezar_create_task({ task: "Fix login bug" })
```

### Tâche avancée
```javascript
cezar_create_task({
  task: "Implement OAuth2",
  workflow: "security-review",
  runner: "claude",
  autonomous: true,
  variants: 2
})
```

### Liste filtrée
```javascript
cezar_list_tasks({ status: "waiting", limit: 10 })
```

### Workflow personnalisé
```javascript
cezar_create_workflow({
  name: "my-workflow",
  content: "steps:\n  - agent:\n      prompt: '{{task}}'"
})
```

### Automation schedule
```javascript
cezar_create_automation({
  name: "Daily check",
  type: "schedule",
  config: { cron: "0 9 * * *" },
  task: { task: "Run health checks" }
})
```

### Dashboard complet
```javascript
const dashboard = await cezar_get_dashboard();
const costs = await cezar_get_cost_stats({ timeRange: "week" });
const insights = await cezar_get_insights();
```

---

## Codes de statut

### Statuts de tâche
- `queued` - En file d'attente
- `running` - En cours d'exécution
- `waiting` - En attente d'action utilisateur
- `review` - Prêt pour review
- `done` - Terminé avec succès
- `failed` - Échoué
- `cancelled` - Annulé

### États GitHub
- `open` - Ouvert
- `closed` - Fermé
- `merged` - Mergé (PRs seulement)
- `all` - Tous

### Types d'automation
- `github` - Événements GitHub
- `tracker` - Événements tracker (Jira/Linear)
- `schedule` - Planification cron

---

## Erreurs courantes

| Erreur | Cause | Solution |
|--------|-------|----------|
| `404` | Tâche/ressource introuvable | Vérifier l'ID |
| `409` | Conflit (ex: tâche active) | Attendre ou annuler |
| `400` | Paramètres invalides | Vérifier le schéma |
| Connection refused | Cezar n'est pas lancé | `cezar serve` |

---

**73 outils pour un contrôle total de cezar via MCP ! 🚀**
