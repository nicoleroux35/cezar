# 🚀 Guide de test rapide - Kilo Code dans Cezar

## Installation et test en 5 minutes

### Prérequis
- Node.js 20+ installé
- npm ou yarn

### Option 1: Test avec Kilo Code installé

```bash
# 1. Installer Kilo Code
npm install -g @kilocode/cli

# 2. Vérifier l'installation
kilo --version

# 3. Configurer un provider (première fois)
kilo auth

# 4. Dans le repo cezar, compiler
npm run typecheck  # Vérifier la compilation
npm run build      # Build complet

# 5. Lancer cezar
npm start

# 6. Créer une tâche avec Kilo
# Dans l'UI, sélectionner "Kilo Code" comme runner
# Taper une tâche simple: "Create a hello world function in Python"
```

### Option 2: Test en mode mock (sans installer Kilo)

```bash
# 1. Dans le repo cezar
npm run typecheck  # Vérifier la compilation

# 2. Lancer en mode dry-run (mock)
CEZ_DRY_RUN=1 npm run dev

# 3. Dans l'UI
# Kilo devrait apparaître comme disponible
# Créer une tâche - elle sera simulée
```

### Option 3: Pointer vers un binaire personnalisé

```bash
# 1. Si Kilo est installé ailleurs
export CEZ_KILO_BIN=/custom/path/to/kilo

# 2. Lancer cezar
npm start
```

---

## Checklist de validation

### ✅ Phase 1: Compilation
```bash
npm run typecheck
# ✓ Devrait passer sans erreur TypeScript
```

### ✅ Phase 2: Tests unitaires
```bash
npm test
# ⚠️ Certains tests vont échouer (listes hardcodées)
# C'est normal et documenté dans KILO_IMPLEMENTATION_PROGRESS.md
```

### ✅ Phase 3: Build
```bash
npm run build
# ✓ Devrait compiler sans erreur
```

### ✅ Phase 4: Détection
Lancer cezar et vérifier dans les logs:
```
✓ kilo: <version>
```

Ou en mode dry-run:
```
✓ kilo: mock (CEZ_DRY_RUN=1)
```

### ✅ Phase 5: UI
Dans l'interface:
1. **Settings → Agents**: Kilo devrait apparaître
2. **New Task**: Kilo devrait être dans la liste des runners
3. **Provider Status**: Kilo devrait apparaître

### ✅ Phase 6: Exécution d'une tâche
Créer une tâche simple:
- Runner: Kilo Code
- Task: "Write a hello world function"
- Vérifier que la tâche démarre
- Vérifier les événements dans la console

---

## Que vérifier

### Dans les logs serveur
```
🔍 Chercher:
- "kilo server listening on http://127.0.0.1:<port>"
- "POST /session" (création de session)
- "POST /session/{id}/message" (envoi de prompt)
- Événements SSE qui arrivent
```

### Dans l'UI
```
✓ Kilo apparaît dans Settings → Agents
✓ Kilo apparaît dans le composer
✓ Une tâche peut être créée avec Kilo
✓ Les événements s'affichent dans le thread
✓ Les tools/appels s'affichent
```

### Dans les événements
```
Vérifier que ces événements apparaissent:
- session.started (backend: 'kilo')
- turn.started
- item.started (pour les messages)
- item.delta (streaming du texte)
- item.completed
- turn.completed
- usage.updated (tokens)
```

---

## Dépannage

### Erreur: "kilo not found"
```bash
# Solution 1: Installer Kilo
npm install -g @kilocode/cli

# Solution 2: Pointer vers le bon chemin
export CEZ_KILO_BIN=/usr/local/bin/kilo

# Solution 3: Utiliser le mode mock
CEZ_DRY_RUN=1 npm start
```

### Erreur de compilation TypeScript
```bash
# Vérifier que tous les fichiers sont présents
bash validate-kilo-implementation.sh

# Re-compiler
npm run typecheck
```

### Kilo n'apparaît pas dans l'UI
```bash
# Vérifier que le build web est à jour
npm run build:web

# Vérifier que Kilo est détecté
# Dans les logs au démarrage, chercher:
# ✓ kilo: <version>
```

### La tâche ne démarre pas
```bash
# Vérifier les logs du serveur
# Chercher des erreurs de spawn ou de connexion

# Tester manuellement que kilo fonctionne
kilo serve --hostname 127.0.0.1 --port 4096
# Devrait afficher: "kilo server listening on http://..."
```

---

## Tests avancés

### Test 1: Multi-turn conversation
```
1. Créer une tâche: "Create a calculator function"
2. Attendre la réponse
3. Envoyer un message: "Add tests for this function"
4. Vérifier que la session continue
```

### Test 2: Provider/model selection
```
1. Créer une tâche avec model: "anthropic/claude-sonnet-4"
2. Vérifier dans les logs que le modèle est passé
3. Vérifier que la tâche fonctionne
```

### Test 3: Interruption
```
1. Créer une tâche longue
2. Cliquer sur "Cancel"
3. Vérifier que le processus s'arrête proprement
4. Vérifier qu'il n'y a pas de processus kilo orphelin
```

### Test 4: Timeout
```
1. Créer une tâche avec un timeout court
2. Attendre le timeout
3. Vérifier le message d'erreur
```

---

## Métriques de succès

### ✅ Build
- [ ] `npm run typecheck` passe
- [ ] `npm run build` réussit
- [ ] Pas d'erreur TypeScript

### ✅ Détection
- [ ] `kilo --version` fonctionne (ou mock en dry-run)
- [ ] Kilo apparaît dans les logs de démarrage
- [ ] Backend check marque Kilo comme "available"

### ✅ UI
- [ ] Kilo dans Settings → Agents
- [ ] Kilo dans le composer
- [ ] Kilo dans les presets de modèle

### ✅ Exécution
- [ ] Une tâche peut être créée avec Kilo
- [ ] Le processus `kilo serve` démarre
- [ ] Les événements apparaissent
- [ ] Le texte streame correctement
- [ ] Les tools s'affichent
- [ ] La tâche se termine proprement

### ✅ Protocole
- [ ] Événements v1 émis
- [ ] Événements v2 émis
- [ ] Tokens comptabilisés
- [ ] Coût affiché (si disponible)

---

## Commandes utiles

```bash
# Validation rapide
bash validate-kilo-implementation.sh

# Compilation seule
npm run typecheck

# Tests unitaires
npm test

# Build complet
npm run build

# Dev mode (avec hot reload)
npm run dev

# Dev mode en mock
CEZ_DRY_RUN=1 npm run dev

# Tests E2E
npm run test:e2e

# Nettoyer et rebuild
rm -rf dist node_modules/.cache
npm run build
```

---

## Logs à surveiller

### Démarrage réussi
```
✓ claude: 1.2.3
✓ codex: 2.3.4
✓ opencode: 3.4.5
✓ kilo: 1.0.0        ← Doit apparaître
✓ git: 2.40.0
```

### Création de tâche
```
[kilo] spawning: kilo serve --hostname 127.0.0.1 --port 45123
[kilo] server listening on http://127.0.0.1:45123
[kilo] POST /session → 200
[kilo] sessionId: abc123
[kilo] SSE connected
[kilo] POST /session/abc123/message → 200
```

### Événements SSE
```
[sse] session.started (backend: kilo)
[sse] turn.started
[sse] item.started (message)
[sse] item.delta (text)
[sse] item.completed
[sse] turn.completed
```

---

## Support

### Documentation
1. **Guide technique**: `KILO_IMPLEMENTATION.md`
2. **Suivi détaillé**: `KILO_IMPLEMENTATION_PROGRESS.md`
3. **Résumé**: `KILO_SUMMARY.md`
4. **Ce guide**: `KILO_QUICKSTART.md`

### Checklist officielle
- `AGENT_PROTOCOL.md` §9

### Commande de validation
```bash
bash validate-kilo-implementation.sh
```

### Statut actuel
- ✅ ~70% complété
- ✅ Fonctionnel pour tests de base
- 🚧 Tests à mettre à jour
- 🚧 UI descriptors à ajouter
- 🚧 Fixtures à créer

---

## Questions fréquentes

### Q: Kilo fonctionne-t-il exactement comme OpenCode?
**R**: Oui, Kilo est un fork d'OpenCode et utilise le même protocole HTTP + SSE.

### Q: Dois-je installer Kilo pour tester?
**R**: Non, vous pouvez utiliser `CEZ_DRY_RUN=1` pour tester sans installer Kilo.

### Q: Quels modèles sont supportés?
**R**: Tous les modèles que Kilo supporte, au format `provider/model` (ex: `anthropic/claude-sonnet-4`).

### Q: Est-ce que c'est compatible avec la version actuelle de Cezar?
**R**: Oui, l'implémentation suit la checklist officielle d'AGENT_PROTOCOL.md.

### Q: Les anciens runs continueront-ils de fonctionner?
**R**: Oui, l'ajout de Kilo n'affecte pas les runs existants.

---

**Bon test! 🚀**

*Pour toute question, consulter la documentation dans les fichiers KILO_*.md*
