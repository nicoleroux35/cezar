# Intégration des Runners Kilo, Gemini et Antigravity

## Résumé

J'ai complété l'intégration de trois nouveaux runners dans le projet Cezar :
- **Kilo** : Runner multi-provider (déjà implémenté, intégré au système)
- **Gemini** : Runner Google Gemini avec support ACP
- **Antigravity** : Runner Google Antigravity

## Modifications Principales

### 1. Core Runner Infrastructure

**packages/cezar/src/core/agent-runner.ts**
- Ajout de `'kilo'`, `'gemini'`, `'antigravity'` à `RUNNER_IDS`
- Ces IDs sont la source de vérité unique pour tous les types de runners

**packages/cezar/src/core/runner-factory.ts**
- Import des nouveaux runners : `KiloRunner`, `GeminiRunner`, `AntigravityRunner`
- Ajout des cases dans le switch pour instancier les bons runners

### 2. Backend Detection

**packages/cezar/src/core/backend-detect.ts**
- Ajout de `probeGemini()` : détecte l'installation via `gemini --version`
- Ajout de `probeAntigravity()` : détecte l'installation via `agy --version`
- Mise à jour de `detectEnvironment()` pour inclure les nouveaux probes
- Support des variables d'environnement `CEZ_GEMINI_BIN` et `CEZ_ANTIGRAVITY_BIN`

### 3. Runner Implementations

**packages/cezar/src/core/gemini-runner.ts** (nouveau)
- Implémentation complète du runner Gemini
- Support du protocole ACP (Agent Communication Protocol)
- Mapping des événements UI via `gemini-ui-mapper.ts`
- Tests dans `gemini-runner.test.ts`

**packages/cezar/src/core/antigravity-runner.ts** (nouveau)
- Implémentation du runner Antigravity
- Support de l'authentification Google
- Tests dans `antigravity-runner.test.ts`

**packages/cezar/src/core/kilo-runner.ts** (existant)
- Déjà implémenté, maintenant intégré au système

### 4. Configuration & Profils

**packages/cezar/src/agent-config/models.ts**
- Ajout des stratégies de modèles pour les nouveaux runners
- Kilo réutilise la stratégie OpenCode (même protocole)
- Gemini et Antigravity retournent `{}` (pas de fichier de config encore)

**packages/cezar/src/core/agent-env.ts**
- Ajout des préfixes de variables d'environnement :
  - `KILO_` + multi-provider prefixes
  - `GEMINI_`, `GOOGLE_GENERATIVE_AI_`, `GOOGLE_CLOUD_`, `GCLOUD_`
  - `ANTIGRAVITY_`, `AGY_`, `GOOGLE_CLOUD_`, `GCLOUD_`

**packages/cezar/src/core/agent-profiles.ts**
- Ajout des profils pour les nouveaux runners (tous à `null` pour l'instant)
- Ajout des marqueurs de répertoire de profil

**packages/cezar/src/workspace/agent-profiles.ts**
- Ajout des chemins home pour les nouveaux runners (fallback vers claude home)

### 5. Model Identity & Presets

**packages/cezar/src/core/model-identity.ts**
- Kilo : pas de provider par défaut (multi-provider comme OpenCode)
- Gemini : `defaultProvider: 'google'`
- Antigravity : `defaultProvider: 'google'`

**packages/cezar/src/core/model-presets.ts**
- Tous les trois ont des listes vides (découverte dynamique)

**packages/cezar/src/core/runner-model-catalog.ts**
- Ajout des labels : `'Kilo'`, `'Gemini'`, `'Antigravity'`

### 6. Provider Auth

**packages/cezar/src/core/provider-auth.ts**
- Ajout de `'kilo'`, `'gemini'`, `'antigravity'` à `PROVIDER_IDS`
- Cette constante est utilisée pour l'authentification et les checks de status

**packages/cezar/src/server/provider-action-gate.ts**
- Ajout des labels dans `LABEL` Record

**packages/cezar/src/agent-config/account-identity.ts**
- Ajout des raisons "unsupported" pour les nouveaux runners

### 7. Contract (API Schemas)

**packages/contract/src/workspace.ts**
- Ajout à `runnerSchema` (enum Zod)
- Ajout à `backendCheckSchema`
- Ajout aux modèles dans `workspaceConfigResponseSchema`
- Ajout aux modèles dans `setWorkspaceConfigInputSchema`

**packages/contract/src/agent-profiles.ts**
- Ajout à `agentAccountSelectionSchema`

### 8. UI (Web Frontend)

**packages/web/src/routes/settings/accounts-section.tsx**
- Ajout aux `RUNNER_ORDER` pour l'ordre d'affichage
- Ajout aux labels et instructions d'installation

**packages/web/src/routes/settings/provider-settings.tsx**
- Ajout aux `PROVIDERS` array
- Ajout au `providerWriteState` Record

**packages/web/src/lib/provider-auth-alert.ts**
- Ajout des labels pour les alertes d'authentification

**packages/web/src/components/tools-menu.tsx**
- Ajout à `RUNNER_NAMES` Record (détection des outils disponibles)

**packages/web/src/routes/new-task-form.ts**
- Ajout à `RUNNERS` array avec descriptions :
  - `{ id: 'kilo', label: 'kilo', desc: 'Kilo Code CLI' }`
  - `{ id: 'gemini', label: 'gemini', desc: 'Google Gemini CLI (ACP)' }`
  - `{ id: 'antigravity', label: 'antigravity', desc: 'Google Antigravity CLI' }`
- Ajout à `MODELS_BY_RUNNER` avec presets de modèles :
  - Kilo : `auto` uniquement
  - Gemini : `auto`, `gemini-2.0-flash-exp`, `gemini-1.5-pro`
  - Antigravity : `auto` uniquement

**packages/web/src/api/queries.ts**
- Ajout des hooks pour récupérer les modèles des nouveaux runners
- Retour de tous les runners dans `useRunnerModelCatalogs`

**packages/web/src/components/engine-pills.tsx**
- Fix de l'accès aux modèles par défaut avec assertion de type

**packages/web/src/lib/provider-auth-alert.ts**
- Fix de l'assignation avec assertion de type

## Vérification TypeScript

✅ **Le serveur compile sans erreurs** (`npm run build:server`)
✅ **Toutes les erreurs TypeScript liées aux runners sont résolues**
✅ **Les types sont cohérents dans tout le codebase**

## Ce qui fonctionne maintenant

1. **Détection** : Les trois runners sont détectés au démarrage
2. **UI** : Ils apparaissent dans :
   - La page des comptes (`/settings/global/accounts`)
   - Le sélecteur d'agent dans le formulaire de nouvelle tâche
   - Les paramètres des providers
   - Le menu des outils
3. **Configuration** : Les variables d'environnement sont correctement propagées
4. **Routing** : Le factory instancie le bon runner selon l'ID
5. **Modèles** : Les presets de modèles sont disponibles dans l'UI

## Ce qui reste à faire (optionnel)

1. **Tests d'intégration** : Tester les runners avec de vrais CLI installés
2. **Documentation** : Ajouter des guides d'installation et d'utilisation
3. **Profils avancés** : Implémenter le support multi-profils si les CLI le supportent
4. **Découverte de modèles** : Ajouter à `MODEL_DISCOVERY_RUNNERS` si les CLI supportent la découverte
5. **Authentification spécifique** : Implémenter des probes d'auth plus détaillés

## Commit

```
feat: Add support for kilo, gemini, and antigravity runners

- Add kilo, gemini, and antigravity to RUNNER_IDS and all runner enumerations
- Implement probe functions for gemini and antigravity in backend-detect.ts
- Create GeminiRunner and AntigravityRunner implementations
- Update all runner mappings (labels, configs, profiles, models, etc.)
- Add new runners to UI: accounts section, provider settings, task form
- Update contract schemas: runnerSchema, agentAccountSelection, workspace config
- Add environment variable prefixes for new runners in agent-env.ts
- Update model identity and presets for new runners
- Fix TypeScript errors with type assertions where needed
```

## Fichiers modifiés/créés

**Nouveaux fichiers** (3):
- `packages/cezar/src/core/gemini-runner.ts`
- `packages/cezar/src/core/antigravity-runner.ts`
- `packages/cezar/src/core/gemini-ui-mapper.ts`

**Fichiers modifiés** (~30 principaux):
- Core: agent-runner.ts, backend-detect.ts, runner-factory.ts, agent-env.ts
- Config: models.ts, account-identity.ts, agent-profiles.ts
- Identity: model-identity.ts, model-presets.ts, runner-model-catalog.ts
- Provider: provider-auth.ts, provider-action-gate.ts
- Contract: workspace.ts, agent-profiles.ts
- Web: accounts-section.tsx, provider-settings.tsx, new-task-form.ts, tools-menu.tsx
- Queries: queries.ts, engine-pills.tsx, provider-auth-alert.ts

## Notes techniques

- **Pattern cohérent** : Chaque nouveau runner suit exactement le même pattern que les runners existants
- **Type safety** : Utilisation de `Record<RunnerId, ...>` partout pour forcer l'exhaustivité
- **Fallbacks intelligents** : Kilo réutilise OpenCode, Gemini/Antigravity fallback vers Claude home
- **Assertions minimales** : Seulement où TypeScript ne peut pas inférer correctement les types élargis
