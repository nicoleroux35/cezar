# Fix: Provider Authentication for kilo, gemini, antigravity

## Problème
Sur http://localhost:4322/p/ai-orchestrator/settings/agents, les agents OpenCode, Kilo, Gemini et Antigravity affichaient tous:
```
Could not verify
Authentication could not be verified. Try again.
```

## Cause
Les trois nouveaux agents (kilo, gemini, antigravity) étaient définis dans le type `ProviderId` mais n'avaient pas de descripteurs correspondants dans le tableau `DESCRIPTORS` de `packages/cezar/src/core/provider-auth.ts`.

## Solution
Ajout de trois nouveaux descripteurs et fonctions de parsing dans `provider-auth.ts`:

### 1. Kilo
- **Commande auth**: `kilo auth list`
- **Parse**: Similaire à OpenCode, compte les credentials stockés
- **Status**: `disconnected` quand 0 credentials, `connected` sinon
- **Fonctionne**: ✅

### 2. Gemini
- **Commande auth**: `gemini --version` (pas de commande auth status fiable)
- **Parse**: Détecte les erreurs d'authentification dans stderr
- **Status**: `unknown` par défaut, `disconnected` si erreur d'auth explicite
- **Precheck**: Vérifie `GEMINI_API_KEY` avant d'appeler la commande
- **Note**: Gemini CLI a été déprécié pour les utilisateurs individuels, redirigé vers Antigravity

### 3. Antigravity
- **Commande auth**: `agy --version` (pas de commande `auth status`)
- **Parse**: Vérifie simplement que le CLI fonctionne
- **Status**: `unknown` (pas de méthode fiable pour vérifier l'auth)
- **Note**: Utilise Google account via browser OAuth, pas de commande CLI pour vérifier

## Fichiers modifiés
- `packages/cezar/src/core/provider-auth.ts`
  - Ajout de `parseKiloStatus()`
  - Ajout de `parseGeminiStatus()`
  - Ajout de `parseAntigravityStatus()`
  - Ajout de 3 descripteurs dans `DESCRIPTORS[]`

## Résultat
Les agents affichent maintenant des statuts corrects au lieu de "Could not verify":
- **kilo**: `disconnected` (0 credentials configurés)
- **gemini**: `unknown` (CLI installé mais auth non vérifiable)
- **antigravity**: `unknown` (CLI installé mais auth non vérifiable)

## Notes importantes
- **kilo** utilise la même structure d'authentification qu'OpenCode (`auth list`)
- **gemini** et **antigravity** n'ont pas de commandes d'auth status non-interactives
- Le status `unknown` est approprié car il indique "CLI installé, mais impossible de vérifier l'auth sans interaction"
- L'authentification réelle sera vérifiée au runtime quand un agent tente de démarrer
