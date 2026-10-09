# Implémentation GitLab, Gitea et Forgejo

## Résumé

Cette implémentation ajoute le support complet de trois nouvelles forges de code : GitLab, Gitea et Forgejo, en plus du support GitHub existant. Le support inclut :

- Détection automatique des remotes (publics et auto-hébergés)
- Listing des issues et PRs/MRs
- Recherche cross-state
- Création de draft PRs/MRs
- Génération d'URLs web
- Support du mode dry-run

## Fichiers modifiés

### 1. Contract & Types

**packages/cezar/src/server/forge/types.ts**
- `ForgeKind` étendu : `'github' | 'gitlab' | 'gitea' | 'forgejo'`

**packages/contract/src/health.ts**
- `forgeInfoSchema.kind` étendu pour accepter les 4 forges

### 2. Détection et résolution

**packages/cezar/src/server/forge/index.ts**
- `FORGE_HOSTS` : ajout de `gitlab.com` et `codeberg.org`
- Fonctions de détection pour instances auto-hébergées :
  - `isGitLabHost()` : détecte gitlab.com et `*gitlab*`
  - `isGiteaHost()` : détecte `*gitea*`
  - `isForgejoHost()` : détecte codeberg.org et `*forgejo*`
- `resolveForge()` : routing vers le bon driver selon le host
- `forgeKindOfRemote()` : classification sans instancier de driver

### 3. Nouveaux drivers

**packages/cezar/src/server/forge/gitlab.ts**
- Driver complet pour GitLab (gitlab.com et self-hosted)
- Utilise le CLI `glab` (https://gitlab.com/gitlab-org/cli)
- Implémente `ForgeDriver` avec :
  - `detect()` : vérifie la disponibilité de glab
  - `listIssues()` / `listPRs()` : listing avec cache 60s
  - `searchItems()` : recherche par query string
  - `createPR()` : création de draft MRs
  - `prStatus()` : status d'une MR par branche
  - `viewUrl()` : génération d'URLs web (format GitLab : `/-/issues/`, `/-/merge_requests/`)
  - Méthodes partielles (à implémenter) : `prMergeState()`, `mergePR()`, `prDiff()`

**packages/cezar/src/server/forge/gitea.ts**
- Driver complet pour Gitea (gitea.com et self-hosted)
- Utilise le CLI `tea` (https://gitea.com/gitea/tea)
- Implémente `ForgeDriver` avec la même interface que GitLab
- Format d'URLs : `/issues/`, `/pulls/`, `/src/branch/`, `/commit/`

**packages/cezar/src/server/forge/forgejo.ts**
- Driver complet pour Forgejo (codeberg.org et self-hosted)
- Utilise le CLI `tea` (Forgejo est un fork de Gitea, compatible)
- Implémente `ForgeDriver` avec la même interface
- Support spécifique de codeberg.org (l'instance publique principale)

### 4. Tests

**packages/cezar/src/server/forge/index.test.ts**
- Tests étendus pour `forgeKindOfRemote()` :
  - GitLab public et self-hosted
  - Gitea self-hosted
  - Forgejo public (codeberg.org) et self-hosted
- Tests étendus pour `resolveForge()` :
  - Routing correct vers chaque driver
  - Support des instances auto-hébergées
- Nouveaux tests `viewUrl()` pour chaque forge :
  - GitLab : format `/-/issues/`, `/-/merge_requests/`
  - Gitea : format `/issues/`, `/pulls/`
  - Forgejo : format `/issues/`, `/pulls/`

### 5. Documentation

**BACKWARD_COMPATIBILITY.md**
- Section §2 mise à jour :
  - `forge?` field étendu : `'github' | 'gitlab' | 'gitea' | 'forgejo'`
  - Changement additive, rétro-compatible

## Détection des instances auto-hébergées

La détection se fait par patterns dans le hostname :

```typescript
// Exemples de hosts détectés
'gitlab.example.com'    → gitlab   (contient 'gitlab')
'gitea.company.com'     → gitea    (contient 'gitea')
'forgejo.example.org'   → forgejo  (contient 'forgejo')
'codeberg.org'          → forgejo  (host connu)
'gitlab.com'            → gitlab   (host connu)
```

## CLIs requis

Chaque forge nécessite son propre CLI :

| Forge    | CLI    | Installation |
|----------|--------|-------------|
| GitHub   | `gh`   | https://cli.github.com |
| GitLab   | `glab` | https://gitlab.com/gitlab-org/cli |
| Gitea    | `tea`  | https://gitea.com/gitea/tea |
| Forgejo  | `tea`  | https://gitea.com/gitea/tea (compatible) |

## Mode dry-run

Chaque driver inclut des données mock pour `CEZ_DRY_RUN=1` :
- Issues et PRs/MRs d'exemple
- URLs fictives mais correctement formattées
- Pas de shell-out aux CLIs

## Fonctionnalités partiellement implémentées

Ces fonctionnalités renvoient `available: false` pour l'instant mais peuvent être étendues :

### GitLab, Gitea, Forgejo :
- `prMergeState()` : état détaillé de merge (checks, blockers, etc.)
- `mergePR()` : merge automatique d'une PR/MR
- `prDiff()` : diff complet des fichiers changés

Ces méthodes sont optionnelles dans `ForgeDriver` et peuvent être implémentées progressivement.

## Parsing de sortie CLI

Les drivers utilisent un parsing basique des sorties CLI (format table) :
- Robuste aux variations de format
- Parsing ligne par ligne avec regex
- Fallback gracieux sur erreurs

Pour une implémentation production, il est recommandé d'utiliser :
- Les options `--json` des CLIs (quand disponibles)
- Les APIs REST directes (sans CLI)

## Structure des URLs web

Chaque forge a son propre format d'URL :

```typescript
// GitHub
https://github.com/owner/repo/issues/123
https://github.com/owner/repo/pull/456

// GitLab
https://gitlab.com/owner/repo/-/issues/123
https://gitlab.com/owner/repo/-/merge_requests/456

// Gitea
https://gitea.com/owner/repo/issues/123
https://gitea.com/owner/repo/pulls/456

// Forgejo
https://codeberg.org/owner/repo/issues/123
https://codeberg.org/owner/repo/pulls/456
```

## Tests à exécuter

```bash
# Typecheck
npm run typecheck

# Tests unitaires
npm test -- packages/cezar/src/server/forge/index.test.ts

# Tests complets
npm test

# Build
npm run build
```

## Compatibilité

### Rétro-compatibilité ✅
- Les anciennes valeurs `forge: 'github'` continuent de fonctionner
- Les projets sans `forge` (remotes non reconnus) fonctionnent toujours
- Les anciennes API responses incluent les nouveaux types de forge de manière additive

### Breaking changes ❌
Aucun - cette implémentation est entièrement additive.

## Prochaines étapes

### Court terme
1. Tester avec de vrais remotes GitLab/Gitea/Forgejo
2. Installer et configurer les CLIs (`glab`, `tea`)
3. Améliorer le parsing CLI avec `--json` flags

### Moyen terme
1. Implémenter `prMergeState()`, `mergePR()`, `prDiff()`
2. Ajouter le support des labels et couleurs
3. Améliorer le parsing des comment counts

### Long terme
1. Migration vers APIs REST directes (sans CLIs)
2. Support des webhooks pour automations
3. Support des CI/CD checks

## Notes d'implémentation

### Pourquoi des CLIs plutôt que des APIs REST ?
- Cohérence avec l'implémentation GitHub existante
- Gestion d'auth unifiée (les CLIs gèrent les tokens)
- Moins de dépendances (pas de SDK supplémentaire)

### Pourquoi des drivers séparés pour Gitea et Forgejo ?
- Permettre des divergences futures entre les deux projets
- Clarté du code et maintenance
- Possibilité d'optimisations spécifiques

### Limitations connues
1. Parsing CLI basé sur format table (fragile)
2. Pas de support des draft PRs natifs sur Gitea (utilise préfixe `[Draft]`)
3. Pas de checks/CI dans les listings (comme GitHub post-#664)

## Auteur

Implémentation réalisée en octobre 2026 pour ajouter le support multi-forge à cezar.
