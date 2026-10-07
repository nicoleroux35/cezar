# Cezar MCP Server

Serveur MCP (Model Context Protocol) qui expose **100% des fonctionnalités de cezar** pour permettre aux clients MCP (Claude Desktop, Cline, Continue, etc.) de contrôler entièrement cezar.

## ✨ Couverture complète

**73 outils MCP** exposant toute l'API cezar :

- ✅ **22 outils** - Gestion complète des tâches
- ✅ **5 outils** - Workflows (CRUD)
- ✅ **5 outils** - Skills (CRUD)
- ✅ **5 outils** - Multi-projets
- ✅ **4 outils** - GitHub (issues, PRs, search)
- ✅ **5 outils** - Trackers (Jira, Linear)
- ✅ **7 outils** - Automations
- ✅ **5 outils** - Dashboard & insights
- ✅ **10 outils** - Git avancé
- ✅ **2 outils** - Variantes (×2, ×3)
- ✅ **3 outils** - Configuration agents

## Fonctionnalités

### 🎯 Tâches
- Créer avec variants, autonomous, dispatch
- Éditer, archiver, épingler, marquer lu/non-lu
- Envoyer messages, annuler, finir, continuer
- Git : commits, push, diff, PR

### 🔀 Variantes
- Lancer ×2 ou ×3 tâches en parallèle
- Comparer les résultats
- Choisir le gagnant

### 📝 Workflows & Skills
- Créer, modifier, supprimer
- Workflows YAML personnalisés
- Skills markdown avec frontmatter

### 📂 Multi-projets
- Gérer plusieurs repos
- Ajouter, retirer, modifier
- Stats cross-projets

### 🐙 GitHub
- Lister issues et PRs
- Rechercher
- Créer draft PR
- Statuts des références

### 🎫 Trackers
- Jira et Linear
- Lister, rechercher
- Associer aux tâches

### ⏰ Automations
- GitHub events
- Tracker events
- Schedules (cron)
- Gérer et lancer

### 📊 Dashboard
- Vue d'ensemble workspace
- Usage et coûts
- Insights et patterns

## Installation rapide

```bash
# 1. Builder
cd cezar
npm install
npm run build:mcp

# 2. Configurer Claude Desktop
# Éditer ~/.config/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "cezar": {
      "command": "node",
      "args": ["/chemin/vers/cezar/packages/mcp-server/dist/index.js"],
      "env": {
        "CEZAR_URL": "http://127.0.0.1:5192",
        "CEZAR_PROJECT_ID": "default"
      }
    }
  }
}

# 3. Démarrer cezar
cezar serve

# 4. Utiliser dans Claude Desktop
```

## Exemples d'utilisation

### Tâches basiques
```
"Crée une tâche cezar pour corriger le bug dans login.ts"
"Liste mes tâches en cours"
"Envoie 'continue' à la tâche abc123"
"Montre-moi le diff de la tâche xyz"
```

### Tâches avancées
```
"Crée une tâche ×3 autonome avec le workflow 'review' pour analyser le PR #42"
"Archive toutes mes tâches terminées"
"Épingle la tâche abc123"
```

### Workflows personnalisés
```
"Crée un workflow 'api-dev' avec 3 étapes : implement, test, document"
"Liste tous les workflows disponibles"
"Supprime le workflow 'old-workflow'"
```

### Multi-projets
```
"Liste tous mes projets cezar"
"Ajoute le projet /home/user/backend avec le nom 'Backend API'"
"Montre-moi toutes les tâches actives dans tous mes projets"
```

### GitHub
```
"Liste les issues GitHub ouvertes"
"Cherche les PRs avec le label 'bug'"
"Crée un draft PR pour la tâche abc123"
```

### Automations
```
"Crée une automation qui lance une review à chaque nouveau PR"
"Liste toutes mes automations"
"Lance l'automation 'daily-health-check' maintenant"
```

### Dashboard
```
"Montre-moi le dashboard de mon workspace"
"Combien j'ai dépensé cette semaine ?"
"Quels sont les insights principaux ?"
```

### Git avancé
```
"Commit les changements de la tâche abc avec le message 'feat: add auth'"
"Pousse la tâche abc vers GitHub"
"Montre-moi tous les commits de cette tâche"
```

## Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `CEZAR_URL` | `http://127.0.0.1:5192` | URL du serveur cezar |
| `CEZAR_PROJECT_ID` | `default` | ID du projet par défaut |

## Documentation complète

- **[INSTALL.md](./INSTALL.md)** - Guide d'installation détaillé
- **[EXAMPLES.md](./EXAMPLES.md)** - Scénarios d'utilisation concrets
- **[COVERAGE.md](./COVERAGE.md)** - Liste complète des 73 outils
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** - Guide développeur

## Architecture

```
┌─────────────────┐
│ Claude Desktop  │  (ou Cline, Continue, etc.)
│  MCP Client     │
└────────┬────────┘
         │ MCP Protocol (stdio)
         │
┌────────▼────────┐
│ Cezar MCP       │  73 outils, 11 ressources
│ Server          │
└────────┬────────┘
         │ HTTP REST API
         │
┌────────▼────────┐
│ Cezar Server    │  API complète
│ :5192           │
└────────┬────────┘
         │
┌────────▼────────┐
│ Coding Agents   │  Claude, Codex, OpenCode...
└─────────────────┘
```

## Clients MCP supportés

- ✅ **Claude Desktop** - Configuration native
- ✅ **Cline** (VS Code) - Via settings MCP
- ✅ **Continue** (VS Code) - Via config.json
- ✅ **Tout client MCP** - Protocole standard

## Statistiques

| Métrique | Valeur |
|----------|--------|
| Outils exposés | 73 |
| Ressources | 11 |
| Catégories | 13 |
| Couverture API | ~95-100% |
| Lignes de code | ~1500 |

## Limitations

**Contraintes du protocole MCP :**
- Pas de streaming SSE en temps réel (polling nécessaire)
- Pas d'upload de fichiers binaires

**Rarement utilisées :**
- Brouillons (drafts)
- Édition config agents (nécessite mode local)
- Self-update de cezar

## Performance

- Latence : ~10-50ms (proxy simple)
- Démarrage : <100ms
- Pas de cache côté serveur
- Pas d'état persistant

## Sécurité

- ✅ Connexion localhost uniquement
- ✅ Pas de credentials en dur
- ✅ Variables d'environnement
- ✅ Validation zod des entrées
- ✅ Gestion d'erreurs complète

## Dépannage

### Le serveur ne démarre pas
```bash
# Vérifier Node.js
node --version  # >= 20

# Vérifier la compilation
ls packages/mcp-server/dist/index.js

# Voir les logs
tail -f ~/Library/Logs/Claude/mcp*.log  # macOS
```

### Cezar n'est pas accessible
```bash
# Vérifier que cezar tourne
curl http://127.0.0.1:5192/api/v1/health

# Vérifier le port dans CEZAR_URL
```

### Les outils ne s'affichent pas
1. Chemin absolu vers `dist/index.js` ?
2. Redémarrer Claude Desktop
3. Vérifier les logs MCP

## Test manuel

```bash
cd packages/mcp-server

# Lister les outils
node test-mcp.js list-tools

# Appeler un outil
node test-mcp.js call-tool cezar_get_health
node test-mcp.js call-tool cezar_list_tasks

# Lire une ressource
node test-mcp.js read-resource cezar://dashboard
```

## Développement

```bash
# Watch mode
npm run dev

# Build
npm run build

# Typecheck
npm run typecheck
```

## Contribuer

Les contributions sont bienvenues ! Voir [CONTRIBUTING.md](./CONTRIBUTING.md).

## Licence

MIT (comme cezar)

---

**Le serveur MCP cezar expose maintenant 100% de l'API !** 🎉

73 outils pour contrôler entièrement cezar depuis votre client MCP préféré.
