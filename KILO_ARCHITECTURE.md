# Architecture de l'implémentation Kilo Code

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CEZAR - Kilo Code Backend                        │
└─────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────┐
│                              USER INTERACTION                              │
├───────────────────────────────────────────────────────────────────────────┤
│  Web UI (React)                                                           │
│  ├─ Composer (sélection Kilo)                                            │
│  ├─ Settings → Agents (configuration)                                     │
│  ├─ Task Thread (visualisation)                                           │
│  └─ Provider Status (détection)                                           │
└────────────────┬──────────────────────────────────────────────────────────┘
                 │
                 ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                           HTTP API (Hono)                                  │
├───────────────────────────────────────────────────────────────────────────┤
│  POST /api/v1/runs          → createRunner('kilo')                        │
│  GET  /api/v1/health        → backend checks (probeKilo)                  │
│  GET  /api/v1/models?runner=kilo → model discovery                        │
└────────────────┬──────────────────────────────────────────────────────────┘
                 │
                 ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                           RUNNER FACTORY                                   │
├───────────────────────────────────────────────────────────────────────────┤
│  createRunner(backend: 'kilo') → new KiloRunner()                         │
│                                                                            │
│  Autres runners:                                                           │
│  ├─ 'claude'   → ClaudeCliRunner                                          │
│  ├─ 'codex'    → CodexAppServerRunner                                     │
│  ├─ 'opencode' → OpencodeServerRunner                                     │
│  └─ 'kilo'     → KiloRunner ✨ NOUVEAU                                    │
└────────────────┬──────────────────────────────────────────────────────────┘
                 │
                 ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                          KILO RUNNER                                       │
├───────────────────────────────────────────────────────────────────────────┤
│  class KiloRunner implements AgentRunner                                  │
│                                                                            │
│  startSession(spec, onEvent, opts) {                                      │
│    ├─ spawn('kilo serve --hostname 127.0.0.1 --port <random>')           │
│    ├─ waitForServerUrl() // Parse stdout pour URL                         │
│    ├─ bootstrap()         // POST /session                                │
│    ├─ consumeEvents()     // SSE /event stream                            │
│    └─ prompt(text)        // POST /session/{id}/message                   │
│  }                                                                         │
│                                                                            │
│  Réutilise:                                                                │
│  ├─ opencode-http.ts      (transport HTTP sans timeout)                  │
│  ├─ opencode-ui-mapper.ts (mapping événements SSE)                       │
│  └─ V1TextCoalescer       (buffering texte)                              │
└────────────────┬──────────────────────────────────────────────────────────┘
                 │
                 ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                      KILO CLI PROCESS                                      │
├───────────────────────────────────────────────────────────────────────────┤
│  $ kilo serve --hostname 127.0.0.1 --port 45123                           │
│                                                                            │
│  Écoute sur: http://127.0.0.1:45123                                       │
│                                                                            │
│  Endpoints:                                                                │
│  ├─ POST /session              → Créer session                            │
│  ├─ POST /session/{id}/message → Envoyer prompt                          │
│  ├─ POST /session/{id}/abort   → Annuler                                 │
│  └─ GET  /event                → SSE event stream                         │
└────────────────┬──────────────────────────────────────────────────────────┘
                 │
                 ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                       SSE EVENT STREAM                                     │
├───────────────────────────────────────────────────────────────────────────┤
│  Server-Sent Events (format OpenCode)                                     │
│                                                                            │
│  Événements émis:                                                          │
│  ├─ message.created        (metadata)                                     │
│  ├─ message.updated        (tokens, cost)                                 │
│  ├─ message.part.created   (texte, tool, reasoning)                       │
│  ├─ message.part.updated   (streaming)                                    │
│  ├─ message.completed      (fin)                                          │
│  ├─ session.idle           (turn boundary ✨)                             │
│  └─ session.error          (erreurs)                                      │
└────────────────┬──────────────────────────────────────────────────────────┘
                 │
                 ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                      OPENCODE UI MAPPER                                    │
├───────────────────────────────────────────────────────────────────────────┤
│  mapOpencodeEvent(evt, state) → { events: UiEvent[], state }             │
│                                                                            │
│  Convertit:                                                                │
│  ├─ message.* → item.started/delta/updated/completed                     │
│  ├─ session.idle → turn.completed                                        │
│  ├─ part.type=text → UiMessageItem                                       │
│  ├─ part.type=tool → UiToolItem                                          │
│  └─ tokens/cost → usage.updated                                          │
│                                                                            │
│  ✨ Réutilisé tel quel - aucun code Kilo-spécifique nécessaire!         │
└────────────────┬──────────────────────────────────────────────────────────┘
                 │
                 ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                      DUAL EVENT EMISSION                                   │
├───────────────────────────────────────────────────────────────────────────┤
│  Le runner émet DEUX streams en parallèle:                                │
│                                                                            │
│  ┌─────────────────────┐        ┌──────────────────────┐                 │
│  │   v1 AgentEvent     │        │   v2 UiEvent         │                 │
│  ├─────────────────────┤        ├──────────────────────┤                 │
│  │ - text              │        │ - session.started    │                 │
│  │ - tool-call         │        │ - turn.started       │                 │
│  │ - tool-result       │        │ - item.started       │                 │
│  │ - token-usage       │        │ - item.delta         │                 │
│  │ - cost              │        │ - item.completed     │                 │
│  │ - turn-end          │        │ - turn.completed     │                 │
│  │ - done              │        │ - usage.updated      │                 │
│  └─────────────────────┘        └──────────────────────┘                 │
│           │                               │                                │
│           └───────────┬───────────────────┘                                │
│                       ▼                                                    │
│              Persisted to NDJSON                                           │
│         (.ai/cezar/runs/<id>.ndjson)                                      │
└────────────────┬──────────────────────────────────────────────────────────┘
                 │
                 ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                        RUN MANAGER                                         │
├───────────────────────────────────────────────────────────────────────────┤
│  - Enregistre les événements                                               │
│  - Met à jour le statut du run                                             │
│  - Gère les transitions d'état                                             │
│  - Émet vers SSE pour le cockpit                                          │
└────────────────┬──────────────────────────────────────────────────────────┘
                 │
                 ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                     COCKPIT (Live Updates)                                 │
├───────────────────────────────────────────────────────────────────────────┤
│  SSE → React Query → UI Components                                         │
│                                                                            │
│  Affiche:                                                                  │
│  ├─ Thread (messages, tools, reasoning)                                   │
│  ├─ Usage (tokens, cost)                                                  │
│  ├─ Status (running, waiting, done)                                       │
│  └─ Plan (todolist si présent)                                            │
└───────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────┐
│                      ENVIRONMENT & SECURITY                                │
├───────────────────────────────────────────────────────────────────────────┤
│  buildChildEnv({ backend: 'kilo', extraEnv: spec.env })                   │
│                                                                            │
│  Variables passées au processus kilo:                                      │
│  ├─ BASE_ALLOW_NAMES (PATH, HOME, SHELL, ...)                            │
│  ├─ BASE_ALLOW_PREFIXES (NODE_, PYTHON_, RUST_, ...)                     │
│  ├─ KILO_* (config Kilo)                                                  │
│  ├─ MULTI_PROVIDER_PREFIXES:                                              │
│  │   ├─ OPENAI_*                                                          │
│  │   ├─ ANTHROPIC_*                                                       │
│  │   ├─ GROQ_*                                                            │
│  │   ├─ MISTRAL_*                                                         │
│  │   └─ ... (17 providers)                                                │
│  └─ GH_* (GitHub pour handoff)                                            │
│                                                                            │
│  ❌ Filtré: Tous les secrets non-nécessaires                              │
└───────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────┐
│                       DETECTION & PROBING                                  │
├───────────────────────────────────────────────────────────────────────────┤
│  detectEnvironment() → [..., probeKilo()]                                 │
│                                                                            │
│  async function probeKilo(): Promise<BackendCheck> {                      │
│    const bin = process.env.CEZ_KILO_BIN ?? 'kilo'                         │
│    const { stdout } = await exec(bin, ['--version'])                      │
│    return {                                                                │
│      name: 'kilo',                                                         │
│      available: true,                                                      │
│      version: stdout.trim(),                                               │
│      hint: 'if no provider configured, run kilo once'                     │
│    }                                                                       │
│  }                                                                         │
│                                                                            │
│  Mode CEZ_DRY_RUN=1:                                                       │
│  → Retourne { available: true, version: 'mock' }                          │
└───────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────┐
│                       KEY FILES MODIFIED                                   │
├───────────────────────────────────────────────────────────────────────────┤
│  Backend Core:                                                             │
│  ✨ kilo-runner.ts               (CRÉÉ - 723 lignes)                      │
│  ✓  agent-runner.ts              (RUNNER_IDS + 'kilo')                    │
│  ✓  runner-factory.ts            (case 'kilo')                            │
│  ✓  backend-detect.ts            (probeKilo)                              │
│  ✓  agent-env.ts                 (BACKEND_ALLOW_PREFIXES)                 │
│  ✓  ui-events.ts                 (UiBackend + 'kilo')                     │
│                                                                            │
│  Contract:                                                                 │
│  ✓  contract/health.ts           (runnerSchema)                           │
│  ✓  contract/workspace.ts        (modelDiscoveryRunnerSchema)             │
│                                                                            │
│  API Client:                                                               │
│  ✓  api-client/ui-events.ts      (UiBackend mirror)                       │
│                                                                            │
│  Web UI:                                                                   │
│  ✓  tools-menu.tsx               (RUNNER_NAMES)                           │
│  ✓  provider-status.ts           (RUNNER_ORDER)                           │
│  ✓  provider-auth-alert.ts       (PROVIDERS)                              │
│  ✓  thread-state.ts              (provider union)                         │
│  ✓  queries.ts                   (useAllRunnerModels)                     │
│                                                                            │
│  Documentation:                                                            │
│  ✓  .env.example                 (CEZ_KILO_BIN)                           │
│  ✨ KILO_IMPLEMENTATION.md        (guide technique)                        │
│  ✨ KILO_IMPLEMENTATION_PROGRESS.md (suivi)                                │
│  ✨ KILO_SUMMARY.md               (résumé)                                 │
│  ✨ KILO_QUICKSTART.md            (test rapide)                            │
│  ✨ validate-kilo-implementation.sh (validation)                           │
└───────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────┐
│                      WHAT MAKES IT WORK                                    │
├───────────────────────────────────────────────────────────────────────────┤
│  ✅ Kilo est un fork d'OpenCode                                           │
│     → Même protocole HTTP + SSE                                            │
│     → Même format d'événements                                             │
│     → Même structure de session                                            │
│                                                                            │
│  ✅ Réutilisation massive du code OpenCode                                │
│     → opencode-http.ts (transport)                                         │
│     → opencode-ui-mapper.ts (événements)                                   │
│     → Aucun mapper Kilo-spécifique nécessaire                             │
│                                                                            │
│  ✅ Architecture modulaire de Cezar                                       │
│     → RUNNER_IDS auto-propage aux schémas                                 │
│     → Factory pattern pour l'isolation                                     │
│     → Mappers réutilisables                                                │
│                                                                            │
│  ✅ Implémentation ~70% par réutilisation                                 │
│     → 723 lignes de code nouveau                                           │
│     → Mais la plupart est du copier-coller intelligent                    │
└───────────────────────────────────────────────────────────────────────────┘

Legend:
  ✨ = Nouveau fichier créé
  ✓  = Fichier existant modifié
  │  = Flux de données
  ▼  = Direction du flux
  → = Transformation/Mapping
```
