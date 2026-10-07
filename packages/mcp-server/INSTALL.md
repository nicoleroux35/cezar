# Guide d'installation et d'utilisation du serveur MCP Cezar

## Vue d'ensemble

Le serveur MCP Cezar permet de piloter cezar depuis n'importe quel client MCP (Claude Desktop, Cline, Continue, etc.). Il expose les fonctionnalités principales de cezar via le protocole MCP (Model Context Protocol).

## Architecture

```
┌─────────────────────┐
│  Claude Desktop     │  (ou autre client MCP)
│  (MCP Client)       │
└──────────┬──────────┘
           │ MCP Protocol (stdio)
           │
┌──────────▼──────────┐
│  Cezar MCP Server   │  (ce package)
└──────────┬──────────┘
           │ HTTP REST API
           │
┌──────────▼──────────┐
│  Cezar Server       │  (packages/cezar)
│  :5192              │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Coding Agents      │  Claude, Codex, OpenCode...
└─────────────────────┘
```

## Installation

### Prérequis

- Node.js >= 20
- Cezar installé et en cours d'exécution

### Étapes

1. **Cloner et installer cezar** (si ce n'est pas déjà fait) :

```bash
git clone https://github.com/open-mercato/cezar
cd cezar
npm install
```

2. **Builder tous les packages** :

```bash
npm run build
```

Cela va compiler :
- Le serveur cezar principal
- Le cockpit web
- Le serveur MCP

3. **Vérifier la compilation du serveur MCP** :

```bash
ls -la packages/mcp-server/dist/
# Vous devriez voir index.js et index.d.ts
```

## Configuration

### Pour Claude Desktop

1. **Localiser le fichier de configuration Claude Desktop** :

   - **macOS** : `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows** : `%APPDATA%\Claude\claude_desktop_config.json`
   - **Linux** : `~/.config/Claude/claude_desktop_config.json`

2. **Ajouter la configuration du serveur MCP** :

```json
{
  "mcpServers": {
    "cezar": {
      "command": "node",
      "args": [
        "/chemin/absolu/vers/cezar/packages/mcp-server/dist/index.js"
      ],
      "env": {
        "CEZAR_URL": "http://127.0.0.1:5192",
        "CEZAR_PROJECT_ID": "default"
      }
    }
  }
}
```

**Important** : Remplacez `/chemin/absolu/vers/cezar` par le chemin réel vers votre installation cezar.

3. **Redémarrer Claude Desktop**

### Pour Cline (VS Code)

1. Ouvrir les paramètres de Cline dans VS Code
2. Aller dans "MCP Servers"
3. Ajouter un nouveau serveur avec la même configuration que ci-dessus

### Pour Continue (VS Code)

Éditer `~/.continue/config.json` :

```json
{
  "mcpServers": [
    {
      "name": "cezar",
      "command": "node",
      "args": [
        "/chemin/absolu/vers/cezar/packages/mcp-server/dist/index.js"
      ],
      "env": {
        "CEZAR_URL": "http://127.0.0.1:5192",
        "CEZAR_PROJECT_ID": "default"
      }
    }
  ]
}
```

## Utilisation

### Démarrage

1. **Démarrer le serveur cezar** :

```bash
cd cezar
npm run dev
# ou
cezar serve
```

Le serveur devrait être accessible sur `http://127.0.0.1:5192`

2. **Ouvrir votre client MCP** (Claude Desktop, Cline, etc.)

Le serveur MCP se connectera automatiquement via stdio.

### Exemples de commandes

Une fois configuré, vous pouvez interagir avec cezar directement depuis votre client MCP :

#### Créer une tâche

```
Crée une tâche cezar pour corriger le bug d'authentification dans login.ts
```

Le client MCP utilisera automatiquement l'outil `cezar_create_task`.

#### Lister les tâches

```
Quelles sont mes tâches cezar en cours ?
```

Utilisera `cezar_list_tasks` avec le filtre `status: "running"`.

#### Obtenir le statut d'une tâche

```
Quel est le statut de la tâche abc123 ?
```

Utilisera `cezar_get_task`.

#### Envoyer un message à une tâche

```
Envoie le message "Utilise bcrypt pour le hachage" à la tâche abc123
```

Utilisera `cezar_send_message`.

#### Voir les modifications d'une tâche

```
Montre-moi le diff de la tâche abc123
```

Utilisera `cezar_get_task_diff`.

## Outils disponibles

Le serveur MCP expose les outils suivants :

| Outil | Description | Paramètres |
|-------|-------------|------------|
| `cezar_create_task` | Créer une nouvelle tâche | `task` (requis), `workflow`, `runner`, `autonomous` |
| `cezar_list_tasks` | Lister toutes les tâches | `status`, `limit` |
| `cezar_get_task` | Détails d'une tâche | `taskId` (requis) |
| `cezar_send_message` | Envoyer un message | `taskId` (requis), `text` (requis) |
| `cezar_cancel_task` | Annuler une tâche | `taskId` (requis) |
| `cezar_list_workflows` | Lister les workflows | - |
| `cezar_list_skills` | Lister les compétences | - |
| `cezar_get_task_diff` | Obtenir le diff git | `taskId` (requis), `maxLines` |
| `cezar_get_health` | État du serveur | - |

## Ressources disponibles

Le serveur expose également des ressources MCP :

| URI | Description |
|-----|-------------|
| `cezar://tasks` | Liste de toutes les tâches |
| `cezar://tasks/{taskId}` | Détails d'une tâche spécifique |
| `cezar://workflows` | Workflows disponibles |
| `cezar://skills` | Compétences disponibles |
| `cezar://health` | État du serveur cezar |

## Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `CEZAR_URL` | `http://127.0.0.1:5192` | URL du serveur cezar |
| `CEZAR_PROJECT_ID` | `default` | ID du projet cezar à utiliser |

## Dépannage

### Le serveur MCP ne démarre pas

1. Vérifiez que Node.js >= 20 est installé :
   ```bash
   node --version
   ```

2. Vérifiez que le serveur MCP est compilé :
   ```bash
   ls packages/mcp-server/dist/index.js
   ```

3. Vérifiez les logs d'erreur dans :
   - **macOS/Linux** : `~/Library/Logs/Claude/mcp*.log` ou console stderr
   - **Windows** : `%APPDATA%\Claude\logs\`

### Le serveur cezar n'est pas accessible

1. Vérifiez que cezar tourne :
   ```bash
   curl http://127.0.0.1:5192/api/v1/health
   ```

2. Si le port est différent, ajustez `CEZAR_URL` dans la configuration MCP

### Les outils ne s'affichent pas dans Claude Desktop

1. Vérifiez que le chemin vers `dist/index.js` est absolu
2. Redémarrez complètement Claude Desktop
3. Vérifiez les logs MCP

### Erreur "Project not found"

Assurez-vous que `CEZAR_PROJECT_ID` correspond à un projet enregistré dans cezar. Pour utiliser le projet par défaut, utilisez `"default"`.

## Test manuel

Pour tester le serveur MCP sans client :

```bash
cd packages/mcp-server
node test-mcp.js list-tools
node test-mcp.js list-resources
node test-mcp.js call-tool cezar_get_health
```

## Développement

### Mode développement

```bash
cd packages/mcp-server
npm run dev  # Watch mode avec recompilation automatique
```

### Tests

```bash
# Lister les outils
node test-mcp.js list-tools

# Appeler un outil
node test-mcp.js call-tool cezar_list_tasks

# Créer une tâche
node test-mcp.js call-tool cezar_create_task '{"task":"Test task"}'
```

### Structure du code

```
packages/mcp-server/
├── src/
│   └── index.ts           # Serveur MCP principal
├── dist/                  # Code compilé (généré)
├── package.json
├── tsconfig.json
├── README.md
├── test-mcp.js           # Script de test
└── claude_desktop_config.example.json
```

## Limitations actuelles

1. **Pas de streaming en temps réel** : Les événements de tâche ne sont pas streamés, vous devez faire du polling avec `cezar_get_task`
2. **Pas d'upload de fichiers** : Les attachments (images, PDFs) ne sont pas supportés via MCP
3. **Un seul projet** : `CEZAR_PROJECT_ID` est fixé au démarrage
4. **Pas de notifications proactives** : Le serveur ne peut pas notifier le client des changements

## Évolutions futures

- [ ] Support du streaming SSE pour les événements en temps réel
- [ ] Support multi-projets dynamique (changement de projet à la volée)
- [ ] Upload d'attachments via MCP
- [ ] Notifications proactives (webhooks MCP)
- [ ] Ressources pour les fichiers et diffs individuels
- [ ] Support des prompts MCP (questions interactives)
- [ ] Intégration avec le système d'automations de cezar

## Contribuer

Les contributions sont bienvenues ! Voir le fichier principal CONTRIBUTING.md à la racine du projet.

## Licence

Même licence que cezar (MIT). Voir LICENSE à la racine du projet.
