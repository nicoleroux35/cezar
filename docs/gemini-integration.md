# Intégration Gemini CLI

## Vue d'ensemble

Le runner Gemini CLI a été ajouté à cezar pour supporter `@google/gemini-cli` via le protocole Agent Client Protocol (ACP).

## Fichiers créés

### Core Runner
- **`packages/cezar/src/core/gemini-runner.ts`** - Runner principal implémentant `AgentRunner`
- **`packages/cezar/src/core/gemini-ui-mapper.ts`** - Dialecte ACP et mappers d'événements UI spécifiques à Gemini
- **`packages/cezar/src/core/gemini-runner.test.ts`** - Tests unitaires pour le runner

### Mock & Tests
- **`packages/cezar/test/mock/gemini-mock.mjs`** - Mock CLI pour `CEZ_DRY_RUN=1`

### Fichiers modifiés
- **`packages/cezar/src/core/agent-runner.ts`** - Ajout de `'gemini'` à `RUNNER_IDS`
- **`packages/cezar/src/core/runner-factory.ts`** - Ajout du case `'gemini'`
- **`packages/cezar/src/core/agent-env.ts`** - Ajout des variables d'environnement Gemini

## Configuration

### Variables d'environnement

```bash
# Chemin du binaire Gemini (optionnel)
CEZ_GEMINI_BIN=/path/to/gemini

# Clé API Gemini (alternative à l'authentification Google)
GEMINI_API_KEY=your_api_key_here

# Autres variables Google supportées
GOOGLE_GENERATIVE_AI_API_KEY=your_key
GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
```

### Authentification

Gemini CLI supporte deux méthodes d'authentification :

1. **Compte Google** (recommandé) :
   ```bash
   gemini  # Ouvre le navigateur pour l'authentification
   ```

2. **Clé API** :
   ```bash
   export GEMINI_API_KEY=your_api_key
   ```

### Comment cezar détermine l'état « connecté »

Le CLI Gemini (0.61.0) n'expose aucune commande d'état d'authentification — `gemini --version`
affiche une version et rien d'autre — donc cezar lit le login stocké : `oauth_creds.json`
(jeton d'accès ou de rafraîchissement) ou l'adresse active dans `google_accounts.json`, sous
`~/.gemini`. Une clé `GEMINI_API_KEY` (ou `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_API_BASE_URL`)
dans l'environnement suffit également. Sans aucun des deux, le fournisseur reste « unknown » et
ne peut pas être lancé. Le CLI n'offre aucune variable pour déplacer ce répertoire : il est
toujours `~/.gemini`.

## Utilisation

### Dans les workflows

```yaml
steps:
  - agent:
      backend: gemini
      model: gemini-2.0-flash-exp  # optionnel
      prompt: "{{task}}"
```

### CLI cezar

```bash
# Démarrer une tâche avec Gemini
cez run --runner gemini "Implémenter une nouvelle fonctionnalité"

# Mode serveur avec Gemini par défaut
cez serve --runner gemini
```

### API

```typescript
// Créer une tâche avec Gemini
POST /api/v1/runs
{
  "task": "Description de la tâche",
  "runner": "gemini",
  "model": "gemini-2.0-flash-exp"
}
```

## Fonctionnalités

### Support ACP complet
- ✅ Session persistante multi-tour
- ✅ Continuation de session (`session/load`)
- ✅ Support des images
- ✅ Auto-approbation des outils (`auto` mode)
- ✅ Replay de session avec marqueur `available_commands_update`
- ✅ Utilisation des tokens (input/output)

### Codes de sortie documentés
- **41** : Échec d'authentification
- **52** : Session introuvable
- **55** : État de session invalide

### Sécurité
- Variables d'environnement filtrées selon `BACKEND_ALLOW_PREFIXES`
- Seules les variables `GEMINI_*`, `GOOGLE_GENERATIVE_AI_*` et `GOOGLE_APPLICATION_CREDENTIALS` sont transmises
- Pas d'héritage complet de l'environnement hôte

## Architecture

### Transport
- **Protocole** : Agent Client Protocol (ACP) via JSON-RPC 2.0
- **Canal** : stdin/stdout (NDJSON)
- **Format** : Messages JSON newline-delimited

### Cycle de vie de session

1. **Bootstrap** :
   ```
   initialize → session/new → session/prompt
   ```

2. **Continuation** :
   ```
   initialize → session/load → [replay] → session/prompt
   ```

3. **Multi-tour** :
   ```
   session/prompt → [response] → session/prompt → ...
   ```

### Mapping d'événements

Le `geminiDialect` (dans `gemini-ui-mapper.ts`) traduit les événements ACP en événements UI v2 :

- `session/update` → événements UI (`message.delta`, `tool.started`, etc.)
- `session/prompt` result → `turn.completed` avec usage
- Erreurs JSON-RPC → messages utilisateur localisés

## Tests

### Exécuter les tests

```bash
# Tests unitaires du runner
npm test -- gemini-runner.test.ts

# Tous les tests
npm test
```

### Mode dry-run

```bash
CEZ_DRY_RUN=1 cez run --runner gemini "Test task"
```

Le mock Gemini (`gemini-mock.mjs`) simule un CLI ACP complet pour les tests sans authentification.

## Prochaines étapes

### Pour production
1. ✅ Runner créé et intégré
2. ⏳ Fixtures golden à capturer d'une vraie session Gemini
3. ⏳ Tests de parité avec autres runners ACP
4. ⏳ Documentation utilisateur complète
5. ⏳ Ajout dans l'UI web (sélecteur de backend)

### Améliorations futures
- Support des plans Gemini (si différent du standard ACP)
- Mapping des outils spécifiques Gemini
- Support des multi-agents Gemini
- Optimisation du cache de contexte

## Différences avec autres runners ACP

| Fonctionnalité | Gemini | Copilot | Junie |
|----------------|--------|---------|-------|
| Authentification | Google compte ou API key | GitHub token | JetBrains compte |
| Replay complet | ✅ Oui, avec marqueur | ❓ Non vérifié | ✅ Oui |
| Codes de sortie | 41, 52, 55 documentés | Non documentés | Documentés |
| Multi-provider | Google AI uniquement | GitHub models | Multi-provider |
| Permissions | Auto-approval | `--allow-all-tools` | `brave_mode` |

## Références

- **Spec** : `.ai/specs/2026-09-19-runner-seam-native-backends.md` Phase 3
- **Contrat** : `AGENT_PROTOCOL.md` §4 (ACP protocol)
- **Dialecte ACP** : `packages/cezar/src/core/acp-ui-mapper.ts`
- **Gemini CLI** : `@google/gemini-cli` (npm package)

## Support

Pour les problèmes d'authentification :
```bash
# Vérifier l'authentification
gemini --version

# Réauthentifier
rm -rf ~/.gemini  # Nettoyer le cache
gemini  # Réauthentifier
```

Pour les erreurs de session :
- Les sessions Gemini peuvent expirer
- En cas d'erreur 52/55, démarrer une nouvelle tâche au lieu de continuer

## Contribution

L'intégration suit le pattern établi par Copilot et Junie. Pour ajouter des fonctionnalités :

1. Mettre à jour `geminiDialect` dans `gemini-ui-mapper.ts`
2. Ajouter les tests dans `gemini-runner.test.ts`
3. Capturer des fixtures golden d'une vraie session
4. Mettre à jour cette documentation
