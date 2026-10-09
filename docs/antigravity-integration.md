# Intégration Antigravity CLI

## Vue d'ensemble

Le runner Antigravity CLI a été ajouté à cezar pour supporter Google Antigravity CLI (`agy`), l'interface terminal de l'agent harness Antigravity 2.0.

## Fichiers créés

### Core Runner
- **`packages/cezar/src/core/antigravity-runner.ts`** - Runner principal implémentant `AgentRunner`
- **`packages/cezar/src/core/antigravity-runner.test.ts`** - Tests unitaires pour le runner

### Mock & Tests
- **`packages/cezar/test/mock/antigravity-mock.mjs`** - Mock CLI pour `CEZ_DRY_RUN=1`

### Fichiers modifiés
- **`packages/cezar/src/core/agent-runner.ts`** - Ajout de `'antigravity'` à `RUNNER_IDS`
- **`packages/cezar/src/core/runner-factory.ts`** - Ajout du case `'antigravity'`
- **`packages/cezar/src/core/agent-env.ts`** - Ajout des variables d'environnement Antigravity

## Configuration

### Variables d'environnement

```bash
# Chemin du binaire Antigravity (optionnel)
CEZ_ANTIGRAVITY_BIN=/path/to/agy

# Variables Google pour authentification
GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
GOOGLE_GENERATIVE_AI_API_KEY=your_key

# Namespace Antigravity (si nécessaire)
ANTIGRAVITY_*
```

### Authentification

Antigravity CLI utilise l'authentification Google :

1. **Première utilisation** :
   ```bash
   agy  # Lance le flow d'authentification via navigateur
   ```

2. **SSH/Remote** :
   - Détecte automatiquement les sessions SSH
   - Affiche une URL d'autorisation à ouvrir localement

3. **Déconnexion** :
   ```bash
   # Dans le TUI Antigravity
   /logout
   ```

### Comment cezar détermine l'état « connecté »

`agy` (1.3.0) n'expose pas plus de commande d'état d'authentification que Gemini — `agy --help`
n'en liste aucune — donc cezar lit le login stocké dans
`~/.gemini/antigravity-cli/antigravity-oauth-token` (un objet JSON avec `token` ou `id_token`).
Une clé `GOOGLE_GENERATIVE_AI_API_KEY` (ou `GOOGLE_API_BASE_URL`) dans l'environnement suffit
également. Sans aucun des deux, le fournisseur reste « unknown » et ne peut pas être lancé.

### Permissions et Review Policy

Antigravity CLI utilise `artifactReviewPolicy` pour contrôler les approbations :
- **`asks-for-review`** (défaut) : Demande confirmation avant d'écrire du code
- **`agent-decides`** : Décide dynamiquement
- **`always-proceed`** : Ne demande jamais (auto-approval)

**Cezar utilise `always-proceed`** pour correspondre à la posture zero-config auto-approval (#430).

## Utilisation

### Dans les workflows

```yaml
steps:
  - agent:
      backend: antigravity
      model: gemini-2.0-flash-thinking-exp  # optionnel
      prompt: "{{task}}"
```

### CLI cezar

```bash
# Démarrer une tâche avec Antigravity
cez run --runner antigravity "Implémenter une nouvelle fonctionnalité"

# Mode serveur avec Antigravity par défaut
cez serve --runner antigravity
```

### API

```typescript
// Créer une tâche avec Antigravity
POST /api/v1/runs
{
  "task": "Description de la tâche",
  "runner": "antigravity",
  "model": "gemini-2.0-flash-thinking-exp"
}
```

## Fonctionnalités

### Support complet Antigravity
- ✅ Mode headless avec JSON output (`--headless --json-output`)
- ✅ Session persistante multi-tour
- ✅ Continuation de conversation (`--conversation-id`)
- ✅ Support des images
- ✅ Auto-approbation (`--artifact-review-policy=always-proceed`)
- ✅ Sélection de modèle (`--model`)
- ✅ Utilisation des tokens (input/output tracking)
- ✅ Multi-step reasoning et planning
- ✅ Multi-file editing

### Événements supportés
- `conversation.started` → Extraction de l'ID de conversation
- `message.started` → Début de réponse
- `message.delta` → Chunks de texte (coalescence)
- `tool.started` → Début d'utilisation d'outil
- `tool.completed` → Fin d'utilisation d'outil
- `turn.completed` → Fin de tour avec usage tokens
- `error` → Erreurs avec messages localisés

### Sécurité
- Variables d'environnement filtrées selon `BACKEND_ALLOW_PREFIXES`
- Seules les variables `ANTIGRAVITY_*`, `GOOGLE_*`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_GENERATIVE_AI_*` sont transmises
- Pas d'héritage complet de l'environnement hôte
- Graceful shutdown avec SIGTERM → SIGKILL watchdog

## Architecture

### Transport
- **Protocole** : JSON-structured events (similaire à stream-json)
- **Canal** : stdout (NDJSON)
- **Format** : Messages JSON newline-delimited

### Différence avec ACP
Antigravity CLI n'utilise **pas** le protocole ACP standard. Il utilise son propre format d'événements JSON :
- Pas de JSON-RPC 2.0 (pas d'ID de requête/réponse)
- Événements unidirectionnels sur stdout
- Pas de canal bidirectionnel stdin/stdout pour les requêtes
- Prompt envoyé via stdin, réponses sur stdout

### Cycle de vie de session

1. **Nouvelle conversation** :
   ```
   spawn agy --headless --json-output
   → envoyer prompt via stdin
   → recevoir conversation.started (ID)
   → recevoir message.delta events
   → recevoir turn.completed
   ```

2. **Continuation** :
   ```
   spawn agy --headless --conversation-id=<uuid>
   → envoyer nouveau message via stdin
   → recevoir événements...
   ```

3. **Multi-tour** :
   ```
   Envoyer message via stdin
   → Recevoir réponse complète
   → Envoyer message suivant
   ```

### Mapping d'événements

Le runner mappe les événements Antigravity vers les événements cezar v1 :

| Événement Antigravity | Événement v1 cezar |
|-----------------------|--------------------|
| `message.delta` | `text` |
| `tool.started` | `tool_use` |
| `tool.completed` | `tool_result` |
| `turn.completed` | `done` |
| `error` | `error` |

## Tests

### Exécuter les tests

```bash
# Tests unitaires du runner
npm test -- antigravity-runner.test.ts

# Tous les tests
npm test
```

### Mode dry-run

```bash
CEZ_DRY_RUN=1 cez run --runner antigravity "Test task"
```

Le mock Antigravity (`antigravity-mock.mjs`) simule un CLI complet pour les tests sans authentification.

## Modèles supportés

Antigravity CLI peut utiliser les modèles Gemini :
- `gemini-2.0-flash-exp` (défaut)
- `gemini-2.0-flash-thinking-exp` (avec raisonnement profond)
- `gemini-1.5-pro`
- `gemini-1.5-flash`

Sélection via `--model` ou configuration TUI (`/model` dans l'interface).

## Commandes spéciales

Antigravity CLI supporte des commandes slash (non exposées dans le runner headless) :

- `/agents` - Gestionnaire d'agents personnalisés
- `/boost <task>` - Raisonnement multi-agent profond
- `/teamwork <task>` - Équipes multi-agents collaboratives (plans payants)
- `/skills` - Parcourir les skills disponibles
- `/tasks` - Gestionnaire de tâches en arrière-plan
- `/context` - Visualisation de l'utilisation du contexte
- `/credits` - Voir les crédits G1 restants

Ces commandes sont accessibles dans l'interface TUI normale mais pas via le mode headless.

## Comparaison avec Gemini CLI

| Fonctionnalité | Antigravity | Gemini CLI |
|----------------|-------------|------------|
| Protocole | JSON events custom | ACP standard |
| Authentification | Google account (keyring) | Google account / API key |
| Interface | TUI + headless | ACP stdio |
| Modèles | Gemini via Google | Gemini direct |
| Multi-agent | ✅ Oui (/teamwork) | ❌ Non |
| Skills | ✅ Oui | ✅ Oui |
| Artifact review | ✅ 3 modes | ❌ Auto seulement |

## Intégration avec Antigravity 2.0 IDE

Antigravity CLI partage :
- **Agent engine** : Même moteur d'agent que l'IDE
- **Settings** : Synchronisation bidirectionnelle des préférences
- **Conversations** : Export de sessions CLI vers IDE

Workflow hybride possible :
1. Démarrer dans le terminal avec `agy`
2. Exporter la conversation vers Antigravity 2.0 IDE
3. Continuer avec l'orchestration visuelle

## Limitations connues

1. **Pas de support ACP** : Antigravity CLI n'implémente pas le protocole ACP standard
2. **Mode headless limité** : Certaines fonctionnalités (agents personnalisés, teamwork) nécessitent le TUI
3. **Authentification obligatoire** : Nécessite un compte Google authentifié
4. **Pas de session/load explicite** : Continuation via `--conversation-id` uniquement

## Troubleshooting

### Problèmes d'authentification

```bash
# Vérifier l'authentification
agy

# Si échoue, nettoyer et réauthentifier
rm -rf ~/.antigravity/auth
agy  # Relance le flow d'authentification
```

### Conversation non trouvée

Les conversations Antigravity peuvent expirer. En cas d'erreur "conversation not found", démarrer une nouvelle tâche au lieu de continuer.

### Quota dépassé

```bash
# Vérifier les crédits dans le TUI
agy
# Puis taper: /credits
```

### Mode headless ne démarre pas

Vérifier que `agy` est installé et dans le PATH :

```bash
which agy
agy --version
```

## Prochaines étapes

### Tests (nécessite Node.js)
```bash
npm test -- antigravity-runner.test.ts
npm run typecheck
npm run build
```

### Capture d'événements réels
- Capturer une vraie session Antigravity authentifiée
- Documenter tous les types d'événements
- Créer des fixtures golden

### UI Web
- Ajouter Antigravity dans le sélecteur de backend
- Ajouter logo/icône Antigravity
- Mettre à jour les descriptions UI

### Documentation
- Ajouter dans `AGENT_PROTOCOL.md`
- Mettre à jour `BACKWARD_COMPATIBILITY.md`
- Ajouter dans les guides utilisateur

## Ressources

- **Site officiel** : https://antigravity.google/product/antigravity-cli
- **Documentation** : https://antigravity.google/docs/cli/overview
- **Repository GitHub** : https://github.com/google-antigravity/antigravity-cli
- **Installation** : `curl -fsSL https://antigravity.google/cli/install.sh | bash`

## Support

Pour les questions et problèmes :
1. Consulter la documentation officielle
2. Vérifier les issues GitHub
3. Contacter le support Google Antigravity

## Contribution

L'intégration suit le pattern établi par les autres runners. Pour améliorer :

1. Mettre à jour le mapping d'événements dans `antigravity-runner.ts`
2. Ajouter les tests dans `antigravity-runner.test.ts`
3. Capturer des fixtures d'une vraie session
4. Mettre à jour cette documentation
