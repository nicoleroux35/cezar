# Guide de Démarrage - Cezar

## Introduction

Cezar est un orchestrateur d'agents de codage AI qui vous permet d'exécuter plusieurs tâches en parallèle, chacune dans son propre environnement git isolé. Ce guide vous accompagne du premier lancement à vos premiers résultats.

## Installation rapide

### Prérequis

- **Node.js 20+** (vérifiez avec `node --version`)
- **Au moins un agent CLI** installé et connecté :
  - [Claude Code](https://github.com/anthropics/claude-code) - `claude`
  - [Codex](https://github.com/openai/codex) - `codex`
  - [OpenCode](https://opencode.ai) - `opencode`
  - [Cursor](https://cursor.com) - `cursor`
  - [Junie](https://junie.jetbrains.com/cli) - `junie`
  - [GitHub Copilot CLI](https://github.com/github/copilot-cli) - `copilot`
- **Git** (optionnel mais recommandé)

### Premier lancement

```bash
cd votre-projet
npx cezar-run
```

Cette commande :
1. Installe cezar si nécessaire
2. Détecte les agents disponibles
3. Lance le serveur sur http://localhost:4321
4. Ouvre le cockpit dans votre navigateur

### Mode démo (sans agent)

Pour explorer l'interface sans configurer d'agent :

```bash
CEZ_DRY_RUN=1 npx cezar-run
```

## Votre première tâche

### 1. Créer une tâche simple

Dans le cockpit :

1. Cliquez sur **"New task"**
2. Entrez une description claire :
   ```
   Ajouter un flag --json à la commande export pour sortir les données en JSON
   ```
3. Sélectionnez un workflow (commencez avec **quick-task**)
4. Choisissez votre agent préféré
5. Cliquez sur **"Start"**

### 2. Suivre l'exécution en direct

Le cockpit affiche en temps réel :
- **Messages de l'agent** - Son raisonnement et ses décisions
- **Appels d'outils** - Fichiers édités, commandes exécutées
- **Tokens & Coûts** - Utilisation des ressources
- **Changements** - Diff des modifications

### 3. Réviser le résultat

Quand la tâche passe en statut **review** :

1. Allez dans l'onglet **"Changes"**
2. Examinez le diff complet
3. Options disponibles :
   - **Continue** - Envoyer des notes à l'agent
   - **Commit** - Accepter les changements
   - **Draft PR** - Créer une pull request brouillon
   - **Abandon** - Rejeter et nettoyer

## Concepts clés

### Worktrees git

Chaque tâche s'exécute dans son propre **worktree git** (`.ai/cezar/worktrees/<id>`), isolé de votre code principal :

- ✅ Plusieurs agents travaillent en parallèle sans conflits
- ✅ Votre branche main reste propre
- ✅ Facile de comparer ou abandonner des tentatives
- ✅ Automatiquement nettoyé après commit/abandon

### Workflows

Un workflow définit les étapes d'une tâche :

```yaml
name: fix-and-verify
steps:
  - id: implement
    prompt: "{{task}}"
    skill: project-conventions
    runner: claude
  - id: test
    command: "npm test"
    onFail: { retry: implement, max: 2 }
```

**Workflows inclus** :
- `quick-task` - Une étape agent simple (pas de config requise)
- `fix-and-verify` - Implémentation + tests avec retry
- `review-and-improve` - Review code existant

**Créer vos workflows** : Placez-les dans `.ai/cezar/workflows/`

### Skills

Les skills sont des **playbooks Markdown** qui donnent du contexte à l'agent :

```markdown
---
name: project-conventions
description: Conventions de code du projet
---

# Conventions du projet

## Style TypeScript
- Utiliser `const` par défaut
- Préférer les interfaces aux types
- Toujours typer les retours de fonction

## Tests
- Un fichier .test.ts par module
- Utiliser vitest pour les tests
- 80% de couverture minimum
```

**Localisation** : `.ai/skills/` ou `.ai/cezar/skills/`

## Cas d'usage courants

### Fix un bug rapidement

```
Fix le bug où la connexion au tracker échoue quand l'URL contient un port
```

**Astuce** : Attachez les logs d'erreur ou captures d'écran pour donner plus de contexte.

### Ajouter une feature

```
Ajouter un système de cache LRU pour les appels API avec TTL configurable.
Les paramètres doivent être : maxSize (nombre d'entrées) et ttlMs (temps de vie).
Ajouter des tests unitaires.
```

**Astuce** : Plus vous êtes précis, meilleurs sont les résultats.

### Refactoriser du code

```
Refactoriser le module auth.ts pour séparer :
1. La validation JWT dans jwt-validator.ts
2. La gestion des sessions dans session-manager.ts
3. Les middlewares Express dans auth-middleware.ts

Conserver tous les tests existants.
```

**Astuce** : Utilisez le skill `refactoring-rules` pour définir vos principes.

### Review automatique

```
Faire une review complète du PR #145 et suggérer des améliorations sur :
- La sécurité
- La performance
- La maintenabilité
- Les tests manquants
```

**Astuce** : Liez la tâche au PR en utilisant l'onglet GitHub.

## Fonctionnalités avancées

### Mode Autonomous

Activez **Autonomous** pour que l'agent ne s'arrête jamais pour demander :
- Il prend les décisions lui-même
- Continue jusqu'à ce que la tâche soit terminée
- Idéal pour laisser tourner la nuit ou sur un serveur

### Variants (×2, ×3)

Lancez la même tâche plusieurs fois pour :
- Comparer différentes approches
- Obtenir plusieurs solutions et choisir la meilleure
- Augmenter les chances de succès sur des tâches difficiles

### Task Dispatch

Les agents peuvent créer des **sous-tâches** indépendantes :
- Chaque sous-tâche a son propre worktree
- Maximum 4 sous-tâches en parallèle
- Les résultats remontent au parent

### Automations

Planifiez des tâches récurrentes :

```yaml
# Vérifier les dépendances chaque lundi 9h
schedule:
  - cron: "0 9 * * MON"
    task: "Vérifier et mettre à jour les dépendances npm outdated"
    workflow: fix-and-verify
```

**Localisation** : `.ai/cezar/automations/`

## Travailler avec plusieurs projets

Cezar garde une **workspace** de tous vos projets :

1. Lancez cezar dans différents repos
2. Accédez au **Dashboard** pour voir tous les projets
3. Basculez entre projets via la barre latérale
4. Chaque projet garde son propre historique

## Commandes utiles

### CLI

```bash
# Mode interactif (lance le serveur + UI)
npx cezar-run

# Mode headless (pas de navigateur)
npx cezar-run run "votre tâche ici"

# Initialiser la structure
npx cezar-run init

# Version nightly (dernières features)
npx cezar-run@nightly
```

### Configuration optionnelle

`.ai/cezar/config.json` :

```json
{
  "baseBranch": "main",
  "defaultWorkflow": "fix-and-verify",
  "maxParallel": 3,
  "memoryLimitMb": 4096,
  "defaultRunner": "claude"
}
```

**Tout est optionnel** - Cezar fonctionne sans configuration.

## Héberger sur un serveur

Pour faire tourner cezar 24/7 sur un VPS :

```bash
npx cezar-run server-install --platform ubuntu-vps
```

Cela configure :
- HTTPS avec Let's Encrypt
- Authentification par mot de passe
- Service systemd
- Accès depuis n'importe où (téléphone inclus)

Guides détaillés : [docs/server-install/](server-install/)

## Résolution de problèmes

### "No agent CLI found"

Installez au moins un agent :
```bash
npm install -g @anthropics/claude-code
claude login
```

### "Not a git repository"

Initialisez git dans votre projet :
```bash
git init
git add .
git commit -m "Initial commit"
```

### "Port 4321 already in use"

Changez le port :
```bash
PORT=8080 npx cezar-run
```

### Les tâches restent "queued"

Vérifiez `maxParallel` dans la config ou arrêtez des tâches en cours.

## Ressources

- **Documentation complète** : [docs/reference.md](reference.md)
- **Issues & Support** : https://github.com/open-mercato/cezar/issues
- **Vidéo démo** : https://www.youtube.com/watch?v=nNLJm9gArnE
- **Site web** : https://cezar.run

## Prochaines étapes

1. ✅ Lancer votre première tâche
2. 📝 Créer un skill avec vos conventions
3. 🔄 Définir un workflow personnalisé
4. 🤖 Activer le mode Autonomous
5. ⏰ Configurer une automation

Bienvenue dans cezar ! 🚀
