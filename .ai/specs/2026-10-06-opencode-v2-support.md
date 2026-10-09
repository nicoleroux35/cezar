# Prise en charge d'OpenCode v2

## Contexte

OpenCode v2 introduit une architecture et un protocole modernisés qui diffèrent de la v1 que cezar supporte actuellement. La migration vers v2 nécessite l'adaptation du runner, du mapper d'événements UI, et potentiellement de la détection de version pour maintenir la compatibilité avec les deux versions pendant la période de transition.

## Objectif

Permettre à cezar d'exécuter des tâches via OpenCode v2 tout en maintenant la compatibilité avec v1 pendant une période de transition. L'intégration doit respecter les invariants zero-config de cezar : une installation OpenCode v2 manquante ou non configurée ne doit jamais empêcher le démarrage de cezar.

## Changements principaux entre v1 et v2

OpenCode est un agent de codage AI open source qui existe en deux versions de protocole :
- **v1** : Protocole original (OpenCode 1.x)
- **v2** : Protocole modernisé (OpenCode 2.x et au-delà)

### Architecture

- **v1** : Serveur HTTP local (`opencode serve`) avec flux SSE pour les événements, une session par serveur
- **v2** : Architecture client-serveur repensée avec nouveau protocole de communication, gestion améliorée des sessions multiples, et API réorganisée

### Protocole d'événements

- **v1** : Événements SSE avec types `message.created`, `message.part.updated`, `session.idle`, etc.
- **v2** : Nouveau schéma d'événements aligné plus étroitement sur le protocole ACP standard, avec types et propriétés restructurés

### Gestion de session

- **v1** : `POST /session` crée, `POST /session/:id/message` envoie prompt, `/event` pour SSE
- **v2** : Endpoints réorganisés, possibilité de sessions concurrentes optimisée, timeouts et lifecycle affinés

### Modèles

- **v1** : Spécification via `{ providerID, modelID }`
- **v2** : Format de spécification de modèle potentiellement étendu avec support amélioré pour les capacités par modèle

## Solution proposée

### Détection de version

Ajouter `packages/cezar/src/core/opencode-version-detect.ts` qui détermine la version d'OpenCode installée :

```typescript
type OpencodeVersion = 'v1' | 'v2' | 'unknown'

interface OpencodeVersionInfo {
  version: OpencodeVersion
  binary: string
  fullVersion?: string  // ex: "2.0.6"
}

async function detectOpencodeVersion(bin?: string): Promise<OpencodeVersionInfo>
```

Stratégie de détection :
1. Exécuter `opencode --version` et parser la sortie
2. Extraire la version numérique (ex: "2.0.6")
3. Si version >= 2.0.0 → `v2`, sinon → `v1`
4. Si échec de détection → `v1` (fallback compatible)

Formats supportés :
- "opencode 2.0.6"
- "OpenCode 2.0.6"
- "OpenCode version 1.5.0"
- "v2.0.6"
- "2.0.6"

### Adaptation du runner

Trois approches possibles :

**Option A (recommandée)** : Runner unifié avec branches internes

Étendre `OpencodeServerRunner` pour supporter les deux versions via des branches internes sur `version`. Les méthodes partagées (`bootstrap`, `prompt`, `consumeEvents`) délèguent à des implémentations spécifiques v1/v2.

**Option B** : Runners séparés

Créer `OpencodeV2ServerRunner` distinct avec `packages/cezar/src/core/opencode-v2-server-runner.ts`. `runner-factory.ts` sélectionne le runner approprié après détection de version.

**Option C** : Adaptateur de protocole

Wrapper/proxy qui traduit le protocole v2 en protocole v1 côté cezar, minimisant les changements dans le runner existant.

**Décision** : Option A pour les raisons suivantes :
- Partage maximal du code de lifecycle (spawn, terminate, timeouts)
- Une seule surface de test pour les deux versions
- Transition progressive plus facile quand v1 sera déprécié
- Cohérent avec l'approche utilisée pour d'autres backends

### Mapper UI v2

Créer ou étendre `packages/cezar/src/core/opencode-v2-ui-mapper.ts` pour mapper les nouveaux événements v2 vers le protocole normalisé `UiEvent` de cezar.

Le mapper doit :
- Convertir les nouveaux types d'événements v2 en `UiEvent` standard
- Maintenir la parité avec les autres backends (Claude, Codex, Cursor, etc.)
- Gérer les nouveaux états/phases introduits en v2
- Préserver la compatibilité avec les golden fixtures existantes

### Endpoints HTTP v2

Adapter `OpencodeSession` pour les nouveaux endpoints :

| v1 | v2 | Notes |
|----|----|----|
| `POST /session` | `POST /v2/session` ou `/session` (selon implémentation v2) | Création de session |
| `POST /session/:id/message` | `POST /v2/session/:id/message` ou équivalent | Envoi de prompt |
| `GET /event` | `GET /v2/events` ou `/events` avec nouveau format | Flux SSE |
| `POST /session/:id/abort` | `POST /v2/session/:id/abort` ou équivalent | Annulation |

La structure exacte dépendra de l'API finale d'OpenCode v2 — ce tableau est indicatif.

### Gestion du modèle

Adapter `parseModelIdentity` et la construction du body dans `prompt()` pour le nouveau format v2 si nécessaire. Préserver `spec.model` comme source de vérité.

Si v2 change le format :
```typescript
// v1
body.model = { providerID: id.provider, modelID: id.model }

// v2 (hypothétique)
body.model = { provider: id.provider, model: id.model, capabilities: [...] }
```

### Variables d'environnement

Ajouter `CEZ_OPENCODE_VERSION` (optionnel) pour forcer une version spécifique lors du développement/débogage :

```bash
CEZ_OPENCODE_VERSION=v2 cez serve  # Force v2
CEZ_OPENCODE_VERSION=v1 cez serve  # Force v1
# Absent → détection automatique
```

Documenter dans `.env.example` et `docs/reference.md`.

## Stratégie de migration

### Phase 1 : Support dual (recommandé pour v0.12)

- Détection automatique de version au démarrage du runner
- Les deux versions fonctionnent côte à côte
- Utilisateurs de v1 non affectés
- Early adopters de v2 peuvent tester
- Logs clairs sur la version détectée

### Phase 2 : v2 par défaut (future v0.13+)

- v2 devient la version recommandée
- v1 reste supportée mais dépréciée avec warning
- Documentation mise à jour pour v2

### Phase 3 : Retrait de v1 (v0.14+ ou plus tard)

- Suppression du code de support v1
- v2 uniquement
- Release note claire sur breaking change

## Tests et validation

### Golden fixtures

Capturer des transcriptions réelles d'OpenCode v2 :
- Lifecycle normal (session start → prompt → tools → completion)
- Tool lifecycle complet
- Annulation mid-turn
- Gestion d'erreurs
- Cas edge (timeout, transport drop, server exit)

Placer dans `packages/cezar/src/core/__fixtures__/opencode-v2/`.

### Tests unitaires

- `opencode-version-detect.test.ts` : détection de version
- `opencode-v2-server-runner.test.ts` : lifecycle du runner v2
- `opencode-v2-ui-mapper.test.ts` : mapping d'événements v2
- Étendre `ui-parity.test.ts` pour inclure les fixtures v2

### Tests d'intégration

- Démarrer une vraie instance OpenCode v2 en `CEZ_DRY_RUN=1` (mock)
- Exercer le cycle complet : create → prompt → tools → review
- Vérifier que v1 continue de fonctionner (régression)

### Validation manuelle

```bash
# Avec OpenCode v2 installé
npm run build
cez serve  # Doit détecter v2 automatiquement
# Créer une tâche, observer les logs
# Vérifier que le mapping UI est correct

# Forcer v1 si toujours installé
CEZ_OPENCODE_VERSION=v1 cez serve
# Vérifier que v1 fonctionne toujours
```

## Dégradation et compatibilité

### Binary manquant

Si `opencode` n'est pas sur PATH et `CEZ_OPENCODE_BIN` non défini :
- Le backend reste dans la liste (`backend-detect.ts`)
- Les tentatives d'exécution échouent avec message clair
- Cezar démarre normalement (autres backends utilisables)

### Version non supportée

Si une future v3 apparaît avant que cezar soit mis à jour :
- Détection retourne `unknown`
- Fallback sur v2 (ou v1 selon implémentation)
- Warning dans les logs
- L'exécution est tentée, échec gracieux si incompatible

### Protocole incompatible

Si v2 introduit des changements cassants non anticipés :
- Les erreurs de parsing sont catchées
- Émission d'événements `error` v1 standard
- L'utilisateur voit un échec explicable
- CEZ_OPENCODE_VERSION=v1 offre une sortie de secours

## Impacts sur le reste du codebase

### Fichiers à modifier

| Fichier | Changement | Raison |
|---------|-----------|---------|
| `packages/cezar/src/core/opencode-server-runner.ts` | Adapter pour v2 ou brancher selon version | Runner principal |
| `packages/cezar/src/core/opencode-ui-mapper.ts` | Étendre ou créer variant v2 | Normalisation UI |
| `packages/cezar/src/core/backend-detect.ts` | Ajouter détection de version | Discovery |
| `packages/cezar/src/core/runner-factory.ts` | Passer version si nécessaire | Factory |
| `.env.example` | Documenter `CEZ_OPENCODE_VERSION` | Env vars |
| `docs/reference.md` | Documenter nouvelle variable | Documentation |

### Fichiers à créer

- `packages/cezar/src/core/opencode-version-detect.ts`
- `packages/cezar/src/core/opencode-v2-ui-mapper.ts` (si séparé)
- `packages/cezar/src/core/__fixtures__/opencode-v2/*.{ndjson,json}`
- Tests associés

### Backward compatibility

Cette feature respecte `BACKWARD_COMPATIBILITY.md` :
- Les surfaces publiques (API HTTP, format des runs, événements v1) restent inchangées
- Les utilisateurs de v1 ne voient aucun changement
- La migration est automatique et transparente pour v2
- `AGENT_PROTOCOL.md` : le runner v2 doit produire les mêmes `UiEvent` normalisés

### Zero config

- Aucun fichier de configuration requis
- Détection automatique de la version installée
- Dégradation gracieuse en cas d'absence
- `CEZ_OPENCODE_VERSION` est optionnel (debug uniquement)

## Hypothèses et questions ouvertes

| # | Question | Réponse appliquée | À confirmer |
|---|----------|-------------------|-------------|
| Q1 | L'API v2 est-elle suffisamment stable pour l'intégration ? | Oui, v2 est en production (version 2.0.6) | Vérifier avec changelog OpenCode v2.0 |
| Q2 | Les deux versions peuvent-elles coexister sur le même système ? | Oui, via binaires séparés ou version flags | Tester en environnement réel |
| Q3 | Le format SSE change-t-il fondamentalement en v2 ? | Probablement oui, mapping requis | Analyser captures v2 |
| Q4 | Faut-il un timeout différent pour v2 ? | Réutiliser les constantes actuelles d'abord | Ajuster si nécessaire après tests |
| Q5 | Les golden fixtures v1 doivent-elles être dupliquées pour v2 ? | Oui, protocoles différents = fixtures séparées | ok |
| Q6 | OpenCode existe-t-il en plusieurs éditions ? | Non, c'est un logiciel open source unique. "OpenCode Go" est un plan d'abonnement ($10/mois) pour accéder aux modèles, pas une édition différente | Confirmé via opencode.ai |

## Alternatives considérées

### Ne supporter que v2

**Rejeté** : Breaking change pour utilisateurs actuels de v1, contraire à la philosophie de cezar de migrations progressives.

### Wrapper de compatibilité externe

**Rejeté** : Ajouterait une dépendance externe, compliquerait le déploiement, contraire au principe zero-config.

### Forcer upgrade v1→v2

**Rejeté** : Cezar ne gère pas l'installation des backends, c'est la responsabilité de l'utilisateur.

## Prochaines étapes

1. **Recherche** : Installer OpenCode v2, capturer des transcriptions réelles, documenter les différences de protocole exactes
2. **Prototype** : Implémenter la détection de version et valider avec v1 existante
3. **Core runner** : Adapter `OpencodeServerRunner` pour dual-version
4. **Mapper** : Implémenter le mapping v2 → `UiEvent`
5. **Tests** : Golden fixtures, unit tests, validation manuelle
6. **Documentation** : Mettre à jour README, guides, troubleshooting

## Références

- `AGENTS.md` : Architecture des runners et seam des backends
- `AGENT_PROTOCOL.md` : Contrat de mapping vers protocole v2 normalisé
- `packages/cezar/src/core/opencode-server-runner.ts` : Implémentation actuelle v1
- Spec `2026-07-21-codex-latest-model-discovery.md` : Pattern de discovery similaire
- Spec `2026-09-27-junie-cli.md` : Exemple récent d'intégration de nouveau backend
- Issue #794 : OpenCode model discovery (contexte existant)

## Date et statut

- **Créée** : 2026-10-06
- **Statut** : DRAFT — En attente de recherche sur protocole v2 exact
- **Assignée** : TBD
- **Implémentation cible** : v0.12.0 (Q4 2026)
