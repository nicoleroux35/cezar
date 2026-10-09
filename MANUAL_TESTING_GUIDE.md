# Guide de Test Manuel - Support Multi-Forge

Ce guide vous aide à tester manuellement l'implémentation du support multi-forge.

## Prérequis

### 1. Installer Node.js et npm

```bash
# Vérifier si déjà installé
node --version
npm --version

# Si non installé:
# - macOS/Linux: https://nodejs.org/
# - Debian/Ubuntu: sudo apt install nodejs npm
```

### 2. Installer les dépendances du projet

```bash
cd /mnt/sdcard/download/Debian/cezar
npm install
```

## Tests Automatisés

### 1. Vérification des types

```bash
npm run typecheck
```

**Attendu:** Pas d'erreurs TypeScript

### 2. Tests unitaires

```bash
# Tous les tests
npm test

# Seulement les tests des forges
npm test -- packages/cezar/src/server/forge/

# Seulement les tests d'index
npm test -- packages/cezar/src/server/forge/index.test.ts
```

**Attendu:** Tous les tests passent (16 nouveaux tests)

### 3. Build

```bash
npm run build
```

**Attendu:** Build réussi sans erreurs

## Tests Manuels avec Remotes

### Préparation

Créer un répertoire de test temporaire:

```bash
mkdir -p /tmp/cezar-forge-test
cd /tmp/cezar-forge-test
```

### Test 1: Détection GitHub

```bash
# Créer un repo git
git init
git remote add origin git@github.com:test/repo.git

# Vérifier la détection
# Le remote devrait être détecté comme 'github'
git remote -v
```

**Tester dans cezar:**
```bash
# Dans le repo
npx cezar
# Vérifier que l'onglet "GitHub" apparaît
```

### Test 2: Détection GitLab (public)

```bash
# Nouveau repo
cd /tmp/cezar-forge-test
mkdir gitlab-test && cd gitlab-test
git init
git remote add origin git@gitlab.com:test/repo.git

# Vérifier
git remote -v
```

**Attendu:** Détection comme 'gitlab'

### Test 3: Détection GitLab (self-hosted)

```bash
# Nouveau repo
cd /tmp/cezar-forge-test
mkdir gitlab-self && cd gitlab-self
git init
git remote add origin https://gitlab.company.com/test/repo.git

# Vérifier
git remote -v
```

**Attendu:** Détection comme 'gitlab' (pattern matching)

### Test 4: Détection Gitea (self-hosted)

```bash
# Nouveau repo
cd /tmp/cezar-forge-test
mkdir gitea-test && cd gitea-test
git init
git remote add origin https://gitea.example.com/test/repo.git

# Vérifier
git remote -v
```

**Attendu:** Détection comme 'gitea'

### Test 5: Détection Forgejo (Codeberg)

```bash
# Nouveau repo
cd /tmp/cezar-forge-test
mkdir forgejo-test && cd forgejo-test
git init
git remote add origin git@codeberg.org:test/repo.git

# Vérifier
git remote -v
```

**Attendu:** Détection comme 'forgejo'

### Test 6: Détection Forgejo (self-hosted)

```bash
# Nouveau repo
cd /tmp/cezar-forge-test
mkdir forgejo-self && cd forgejo-self
git init
git remote add origin https://forgejo.example.org/test/repo.git

# Vérifier
git remote -v
```

**Attendu:** Détection comme 'forgejo'

## Tests CLI

### Installation des CLIs

```bash
# macOS
brew install gh glab tea

# Linux - vérifier les docs officielles
```

### Authentification

```bash
# GitHub
gh auth login

# GitLab
glab auth login

# Gitea/Forgejo
tea login add
```

### Test des CLIs

```bash
# GitHub
gh version

# GitLab
glab version

# Gitea/Forgejo
tea version
```

## Tests Dry-Run

Le mode dry-run permet de tester sans CLIs installés:

```bash
# Dans un repo avec remote GitLab
CEZ_DRY_RUN=1 npx cezar

# Le driver devrait utiliser les mock data
# et ne pas tenter de shell-out vers glab
```

## Tests d'API (Node REPL)

Pour tester les fonctions individuellement:

```bash
cd /mnt/sdcard/download/Debian/cezar
node
```

```javascript
// Dans Node REPL

// Test parseRemote
const { parseRemote } = require('./packages/cezar/dist/server/forge/index.js');

parseRemote('git@gitlab.com:owner/repo.git');
// Attendu: { host: 'gitlab.com', owner: 'owner', repo: 'repo' }

parseRemote('https://gitea.example.com/owner/repo.git');
// Attendu: { host: 'gitea.example.com', owner: 'owner', repo: 'repo' }

parseRemote('git@codeberg.org:user/repo.git');
// Attendu: { host: 'codeberg.org', owner: 'user', repo: 'repo' }

// Test forgeKindOfRemote
const { forgeKindOfRemote } = require('./packages/cezar/dist/server/forge/index.js');

forgeKindOfRemote('git@gitlab.com:owner/repo.git');
// Attendu: 'gitlab'

forgeKindOfRemote('https://gitea.company.com/owner/repo.git');
// Attendu: 'gitea'

forgeKindOfRemote('git@codeberg.org:user/repo.git');
// Attendu: 'forgejo'

forgeKindOfRemote('https://forgejo.example.org/owner/repo.git');
// Attendu: 'forgejo'

forgeKindOfRemote('git@github.com:owner/repo.git');
// Attendu: 'github'

forgeKindOfRemote('https://unknown.com/owner/repo.git');
// Attendu: null
```

## Tests avec vrais projets

### Projet GitLab

```bash
# Cloner un vrai projet GitLab
git clone git@gitlab.com:YOUR_USER/YOUR_PROJECT.git
cd YOUR_PROJECT

# Lancer cezar
npx cezar

# Vérifier:
# 1. L'onglet "GitLab" apparaît
# 2. Les issues sont listées
# 3. Les MRs sont listées
# 4. La recherche fonctionne
```

### Projet Gitea

```bash
# Cloner un vrai projet Gitea
git clone https://gitea.example.com/YOUR_USER/YOUR_PROJECT.git
cd YOUR_PROJECT

# Lancer cezar
npx cezar

# Vérifier les mêmes éléments
```

### Projet Forgejo (Codeberg)

```bash
# Cloner un vrai projet Codeberg
git clone git@codeberg.org:YOUR_USER/YOUR_PROJECT.git
cd YOUR_PROJECT

# Lancer cezar
npx cezar

# Vérifier les mêmes éléments
```

## Checklist de Validation

### Code
- [ ] `npm run typecheck` passe sans erreurs
- [ ] `npm test` passe tous les tests
- [ ] `npm run build` réussit
- [ ] Pas de warnings TypeScript

### Détection
- [ ] GitHub détecté correctement
- [ ] GitLab public détecté
- [ ] GitLab self-hosted détecté
- [ ] Gitea self-hosted détecté
- [ ] Forgejo (Codeberg) détecté
- [ ] Forgejo self-hosted détecté
- [ ] Remote inconnu retourne null

### Fonctionnalités
- [ ] L'onglet forge apparaît (GitHub/GitLab/Gitea/Forgejo)
- [ ] Liste des issues fonctionne
- [ ] Liste des PRs/MRs fonctionne
- [ ] Recherche fonctionne
- [ ] Création de draft PR/MR fonctionne
- [ ] URLs web sont correctes
- [ ] Mode dry-run fonctionne

### Documentation
- [ ] README mis à jour (optionnel)
- [ ] BACKWARD_COMPATIBILITY.md correct
- [ ] Guide utilisateur complet
- [ ] Guide technique complet

## Debugging

### Erreurs TypeScript

Si des erreurs TypeScript apparaissent:

```bash
# Nettoyer et reconstruire
npm run clean  # si la commande existe
rm -rf dist/
npm run build
```

### Erreurs de tests

```bash
# Exécuter un test spécifique avec plus de détails
npm test -- packages/cezar/src/server/forge/index.test.ts --reporter=verbose
```

### Erreurs de détection

Ajouter des logs pour debugging:

```javascript
// Dans packages/cezar/src/server/forge/index.ts

export function forgeKindOfRemote(remote: string | undefined): ForgeKind | null {
  console.log('Detecting forge for remote:', remote);
  const parsed = remote ? parseRemote(remote) : null;
  console.log('Parsed:', parsed);
  
  if (!parsed) return null;
  
  const kind = FORGE_HOSTS[parsed.host];
  console.log('Known host kind:', kind);
  
  if (kind) return kind;
  
  // ... rest of the function
}
```

## Rapport de Test

Après avoir exécuté tous les tests, créer un rapport:

```markdown
# Rapport de Test - Support Multi-Forge

## Date
[Date]

## Environnement
- OS: [Linux/macOS/Windows]
- Node version: [version]
- npm version: [version]

## Tests Automatisés
- [ ] Typecheck: ✅/❌
- [ ] Tests unitaires: ✅/❌
- [ ] Build: ✅/❌

## Tests Manuels
- [ ] Détection GitHub: ✅/❌
- [ ] Détection GitLab: ✅/❌
- [ ] Détection Gitea: ✅/❌
- [ ] Détection Forgejo: ✅/❌
- [ ] CLIs installés: ✅/❌
- [ ] Dry-run mode: ✅/❌

## Problèmes Rencontrés
[Décrire les problèmes]

## Notes
[Notes additionnelles]
```

## Support

En cas de problème:

1. Vérifier que Node.js >= 20 est installé
2. Vérifier que les dépendances sont à jour (`npm install`)
3. Consulter les logs de tests (`npm test -- --reporter=verbose`)
4. Vérifier BACKWARD_COMPATIBILITY.md pour les changements
5. Consulter FORGE_INTEGRATION_IMPLEMENTATION.md pour les détails techniques
