# Implémentation du support Kilo Code dans Cezar

## Vue d'ensemble

Ce document suit l'implémentation de Kilo Code comme nouveau backend dans Cezar, conformément à la checklist du §9 de `AGENT_PROTOCOL.md`.

**Statut**: En cours (étapes 1-3 complétées)

## Contexte

Kilo Code est un agent de codage IA open source (MIT) qui est un **fork d'OpenCode**. Il supporte:
- 500+ modèles AI via format `provider/model`
- Commande `kilo serve` pour lancer un serveur HTTP + SSE (protocole identique à OpenCode)
- Installation: `npm i -g @kilocode/cli` ou via https://kilo.ai
- Configuration dans `~/.kilo/` ou `~/.kilocode/`

## Étapes complétées ✅

### 1. Runner (kilo-runner.ts) ✅
- [x] Créé `packages/cezar/src/core/kilo-runner.ts`
- [x] Implémente `AgentRunner` / `AgentSession`
- [x] Réutilise la logique OpenCode (même protocole HTTP + SSE)
- [x] Support `kilo serve --hostname 127.0.0.1 --port <random>`
- [x] Gestion `CEZ_KILO_BIN` pour override du binaire
- [x] Utilise `prependSystemPrompt` (pas de canal système natif)
- [x] Support `provider/model` via `parseModelIdentity`

### 2. Factory ✅
- [x] Ajouté `kilo` à `RUNNER_IDS` dans `agent-runner.ts`
- [x] Ajouté case `'kilo'` dans `createRunner()` (`runner-factory.ts`)
- [x] Import `KiloRunner` dans le factory

### 3. Detection ✅
- [x] Ajouté `kilo` au type `BackendCheck.name`
- [x] Créé `probeKilo()` dans `backend-detect.ts`
- [x] Ajouté appel `probeKilo()` dans `detectEnvironment()`
- [x] Support `CEZ_DRY_RUN=1` (mock mode)
- [x] Message d'aide: installation via npm ou https://kilo.ai

### 4. Environment & Credentials ✅
- [x] Ajouté `kilo: ['KILO_', ...MULTI_PROVIDER_PREFIXES]` dans `BACKEND_ALLOW_PREFIXES` (`agent-env.ts`)
- [x] Documenté `CEZ_KILO_BIN` dans `.env.example`

## Étapes restantes 🚧

### 5. Mapper (kilo-ui-mapper.ts) 🔄
Puisque Kilo est un fork d'OpenCode avec le même protocole, nous **réutilisons le mapper OpenCode**:
- [ ] Vérifier si le mapper OpenCode existant fonctionne tel quel
- [ ] Option A: Alias vers `opencode-ui-mapper.ts` (aucun changement nécessaire)
- [ ] Option B: Créer `kilo-ui-mapper.ts` qui réexporte le mapper OpenCode si besoin de personnalisations futures

**Action**: Pour l'instant, le runner utilise déjà `mapOpencodeEvent` et `opencodeSessionStarted` - cela devrait suffire.

### 6. Golden Fixtures 📝
- [ ] Créer `packages/cezar/src/core/__fixtures__/kilo/`
- [ ] Ajouter des fichiers `.ndjson` (transcriptions wire-faithful du protocole Kilo)
- [ ] Ajouter des fichiers `.expected.json` (événements UiEvent attendus)
- [ ] Créer `kilo-ui-mapper.test.ts` pour rejouer les fixtures
- [ ] Citer la source upstream (documentation Kilo / captures réelles)

**Note**: Comme Kilo partage le protocole OpenCode, les fixtures peuvent être similaires avec des différences mineures dans les métadonnées.

### 7. Tests de parité 🧪
- [ ] Ajouter `kilo` à `BACKENDS` dans `ui-parity.test.ts`
- [ ] Assurer que toutes les capacités de la matrice passent:
  - `plan.updated` (TodoWrite / plan)
  - Tool status (running, completed, failed)
  - Reasoning items
  - Structured diffs
  - Sub-agent task items
  - `usage.updated` avec tokens
  - `turn.completed` avec `stopReason`
  - Sub-agent nesting via `parentItemId` (si supporté par Kilo)

### 8. Plumbing (schémas et types) 📊
**Fichiers à mettre à jour**:

#### Backend
- [ ] `packages/cezar/src/runs/store.ts` - Ajouter `kilo` au schema `runner`
- [ ] `packages/cezar/src/workflows/types.ts` - Ajouter `kilo` au schema des steps
- [ ] `packages/cezar/src/server/server.ts` - Schemas des routes API

#### Contract
- [ ] `packages/contract/src/*.ts` - Ajouter `kilo` aux schémas zod pertinents

#### API Client
- [ ] `packages/api-client/src/protocol/ui-events.ts` - Ajouter `kilo` à `UiBackend`

#### Web (Cockpit)
- [ ] `packages/web/src/types.ts` - Type `Runner`
- [ ] `packages/web/src/components/composer/` - Pills et presets
- [ ] `packages/web/src/routes/settings/agents.tsx` - Configuration Kilo
- [ ] Ajouter logo/icône Kilo si nécessaire

### 9. Sélection de modèle 🎯
- [ ] Vérifier que `provider/model` fonctionne (ex: `anthropic/claude-sonnet-4`)
- [ ] Ajouter entrée dans `BACKEND_MODEL_MAP` si Kilo a un provider par défaut
- [ ] Tester que les modèles sans provider explicite échouent avec un message clair

### 10. Permissions ⚠️
- [ ] Vérifier le comportement de Kilo avec les permissions
- [ ] Documenter: Kilo utilise `--auto` pour auto-approuver (comme dans la doc CLI)
- [ ] S'assurer qu'une demande de permission ne bloque pas indéfiniment

### 11. Documentation 📚
- [ ] Mettre à jour `AGENT_PROTOCOL.md` - Ajouter Kilo dans les exemples
- [ ] Mettre à jour `AGENTS.md` - Documenter le support Kilo
- [ ] Mettre à jour `README.md` - Mentionner Kilo comme backend supporté
- [ ] Ajouter section dans `docs/` si nécessaire

### 12. Tests E2E 🎬
- [ ] Ajouter tests pour Kilo dans la suite de tests
- [ ] Tester le cycle complet: détection → run → événements → résultat
- [ ] Tester avec `CEZ_DRY_RUN=1` (mock)

## Notes d'implémentation

### Réutilisation du code OpenCode
Le runner Kilo réutilise massivement le code OpenCode car le protocole est identique:
- `opencode-http.ts` - Transport HTTP/SSE
- `opencode-ui-mapper.ts` - Mapping des événements
- Même structure de session avec `POST /session` et `POST /session/{id}/message`
- Même format d'événements SSE

### Différences potentielles Kilo vs OpenCode
À vérifier lors des tests réels:
1. Format exact de la sortie `kilo --version`
2. Bannière de démarrage de `kilo serve` (regex d'extraction d'URL)
3. Chemins de configuration (`~/.kilo/` vs `~/.kilocode/`)
4. Noms d'outils spécifiques à Kilo (si différents d'OpenCode)

### Variables d'environnement Kilo
D'après la documentation Kilo:
- `KILO_API_KEY` - Clé API Kilo Gateway
- `KILO_ORG_ID` - Organisation ID
- `KILO_SERVER_PASSWORD` - Auth du serveur (optionnel)
- `KILO_SERVER_USERNAME` - Username auth (défaut: `kilo`)
- Tous les providers: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.

## Commandes de test

```bash
# Vérifier la compilation
npm run typecheck

# Lancer les tests unitaires
npm test

# Lancer les tests de package
npm run build
npm run test:package

# Lancer les tests E2E (nécessite kilo installé OU CEZ_DRY_RUN=1)
npm run test:e2e

# Test manuel avec Kilo
CEZ_KILO_BIN=/usr/local/bin/kilo npm run dev
```

## Validation finale

Avant de considérer l'implémentation complète:
- [ ] Tous les tests passent (typecheck, unit, package, e2e)
- [ ] Le runner Kilo apparaît dans Settings → Agents
- [ ] Une tâche peut être créée et exécutée avec Kilo
- [ ] Les événements v1 et v2 sont émis correctement
- [ ] La détection fonctionne avec et sans `CEZ_KILO_BIN`
- [ ] Le mode `CEZ_DRY_RUN=1` fonctionne
- [ ] Documentation complète et à jour

## Références

- [Kilo Code Website](https://kilo.ai)
- [Kilo GitHub](https://github.com/Kilo-Org/kilocode)
- [Kilo CLI Docs](https://kilo.ai/docs/cli)
- [OpenCode Protocol](https://opencode.ai)
- Cezar: `AGENT_PROTOCOL.md` §9 - Checklist pour ajouter un runner
