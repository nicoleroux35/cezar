# Vérification de la configuration des forges dans Settings (http://localhost:4321/settings/global)

## 📋 Résumé

**ATTENTION** : La configuration des forges (GitHub, GitLab, Gitea, Forgejo) **n'est PAS dans Settings → Providers**.

Les **Providers** dans `/settings/global` concernent uniquement les **agents de codage** (Claude, Codex, etc.), pas les forges.

---

## ❌ Constat : Confusion entre Providers et Forges

### 1. Settings → Providers (ce qui existe)

**URL :** `http://localhost:4321/settings/global` (section implicite "Providers")

**Fichier :** `packages/web/src/routes/settings/provider-settings.tsx`

**Ce qui est configuré :**
```typescript
export const PROVIDERS = [
  { id: 'claude', label: 'Claude Code', login: 'claude auth login' },
  { id: 'codex', label: 'Codex', login: 'codex login' },
  { id: 'junie', label: 'Junie', login: 'junie login' },
  { id: 'opencode', label: 'OpenCode', login: 'opencode auth login' },
  { id: 'cursor', label: 'Cursor', login: 'agent login' },
  { id: 'pi', label: 'pi', login: 'pi /login' },
  { id: 'copilot', label: 'GitHub Copilot CLI', login: 'copilot login' },
  { id: 'kilo', label: 'Kilo', login: 'kilo login' },
] as const
```

**Rôle :** Gérer les **coding agents** (les IA qui écrivent le code)

---

### 2. Ce qui n'existe PAS : Configuration des forges dans Settings

Il n'y a **AUCUNE section Settings** pour configurer :
- GitHub
- GitLab
- Gitea
- Forgejo

**Vérifications effectuées :**
```bash
# Recherche dans tous les fichiers settings
grep -r "github\|gitlab\|gitea\|forgejo" packages/web/src/routes/settings/*.tsx

# Résultat : AUCUNE référence aux forges
# Seulement 2 mentions de "github" :
# - pi: 'https://github.com/badlogic/pi-mono' (lien externe)
# - copilot: 'npm i -g @github/copilot' (GitHub Copilot = agent)
```

**Registry des sections Settings :**
```typescript
// packages/web/src/routes/settings/registry.tsx
export const SETTINGS_SECTIONS: SettingsSection[] = [
  // Project scope
  { id: 'tracker', ... },      // Issue tracker (Jira, Linear)
  { id: 'agents', ... },        // Agents runners
  { id: 'agent-config', ... },  // Agent config files
  { id: 'worktrees', ... },
  { id: 'bookmarklets', ... },
  { id: 'prompt-templates', ... },
  
  // Global scope
  { id: 'appearance', ... },
  { id: 'notifications', ... },
  { id: 'resources', ... },
  { id: 'skills', ... },
  { id: 'accounts', ... },      // Agent accounts (pas forges)
  { id: 'projects', ... },
  { id: 'keyboard', ... },
]

// AUCUNE section pour les forges
```

---

## ✅ Comment les forges sont réellement configurés

### Configuration automatique via CLI

Les forges **ne passent pas par Settings**. Ils sont configurés **en ligne de commande** :

#### GitHub
```bash
# Installation
brew install gh

# Authentication
gh auth login
# → Suit le flow OAuth dans le navigateur
# → Sauvegarde le token dans ~/.config/gh/hosts.yml
```

#### GitLab
```bash
# Installation
brew install glab

# Authentication
glab auth login
# → Demande le token GitLab
# → Sauvegarde dans ~/.config/glab-cli/config.yml

# Self-hosted
glab auth login --hostname gitlab.company.com
```

#### Gitea
```bash
# Installation
brew install tea

# Authentication
tea login add --name myinstance --url https://gitea.example.com
# → Demande username/password ou token
# → Sauvegarde dans ~/.config/tea/config.yml
```

#### Forgejo
```bash
# Installation (même CLI que Gitea)
brew install tea

# Authentication
tea login add --name forgejo --url https://forgejo.example.org
# → Sauvegarde dans ~/.config/tea/config.yml
```

---

## 🔍 Détection automatique dans cezar

Une fois les CLIs configurés, cezar détecte automatiquement le forge depuis le git remote :

```typescript
// packages/cezar/src/server/forge/index.ts

const FORGE_HOSTS: Record<string, ForgeKind> = {
  'github.com': 'github',
  'gitlab.com': 'gitlab',
  'codeberg.org': 'forgejo',
};

function isGitLabHost(host: string): boolean {
  return host === 'gitlab.com' || host.includes('gitlab');
}

function isGiteaHost(host: string): boolean {
  return host.includes('gitea');
}

function isForgejoHost(host: string): boolean {
  return host === 'codeberg.org' || host.includes('forgejo');
}
```

**Exemple :**
```bash
cd my-gitlab-project
git remote -v
# origin  git@gitlab.com:owner/repo.git

cezar serve
# → Détecte automatiquement GitLab
# → Onglet "GitLab" dans l'interface
# → Utilise `glab` CLI pour les opérations
```

---

## 📊 Architecture actuelle

```
┌─────────────────────────────────────────────────────┐
│ Settings → Providers                                │
│ http://localhost:4321/settings/global               │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ✅ Claude Code      [●] Connected    [Toggle]      │
│ ✅ Codex           [●] Connected    [Toggle]      │
│ ✅ Junie           [○] Not connected [Connect]     │
│ ✅ OpenCode        [●] Connected    [Toggle]      │
│ ✅ Cursor          [○] Not installed               │
│ ✅ pi              [●] Connected    [Toggle]      │
│ ✅ Copilot CLI     [○] Not connected [Connect]     │
│ ✅ Kilo            [●] Connected    [Toggle]      │
│                                                     │
│ ❌ PAS de section pour forges (GitHub, GitLab...)  │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Forges (GitHub, GitLab, Gitea, Forgejo)            │
│ Configuration : CLI uniquement                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Configuration :                                     │
│   • gh auth login                                   │
│   • glab auth login                                 │
│   • tea login add                                   │
│                                                     │
│ Détection :                                         │
│   • Automatique depuis git remote                   │
│   • Aucune UI dans Settings                         │
│                                                     │
│ Interface :                                         │
│   • Onglet GitHub/GitLab/Gitea/Forgejo             │
│   • Liste issues/PRs                                │
│   • Création draft PR                               │
│   • Merge operations                                │
└─────────────────────────────────────────────────────┘
```

---

## 🎯 Pourquoi pas dans Settings ?

### Raisons de design

1. **Délégation aux CLIs officiels**
   - Chaque forge a son propre flow OAuth
   - Les CLIs gèrent tokens, refresh, multi-comptes
   - Cezar ne réinvente pas cette complexité

2. **Zero config**
   - Principe AGENTS.md : "Discover it, or default it"
   - Si le CLI est configuré → fonctionne automatiquement
   - Si pas configuré → dégradation silencieuse

3. **Sécurité**
   - Pas de stockage de tokens dans cezar
   - Les CLIs gèrent le keychain/credential manager
   - Cezar invoque juste les commandes

4. **Multi-comptes natif**
   - `gh` : plusieurs comptes via `gh auth switch`
   - `glab` : plusieurs hosts dans config.yml
   - `tea` : plusieurs logins nommés
   - Settings devrait réimplémenter tout ça

---

## ✅ Ce qui fonctionne SANS Settings

### 1. Détection automatique
```bash
cd my-repo
cezar serve
# → Lit git remote
# → Détecte le forge automatiquement
# → Charge le driver approprié
```

### 2. Vérification status
```bash
# Vérifier que les CLIs sont configurés
gh auth status
glab auth status
tea login list
```

### 3. Interface adaptative
- Repo GitHub → Onglet "GitHub"
- Repo GitLab → Onglet "GitLab"
- Repo Gitea → Onglet "Gitea"
- Repo Forgejo → Onglet "Forgejo"

### 4. Health check
```bash
GET /api/v1/health
```
```json
{
  "forge": {
    "kind": "gitlab",
    "available": true
  }
}
```

---

## 📝 Documentation utilisateur

La doc `docs/multi-forge-support.md` explique clairement la config CLI :

```markdown
## Setup

### 1. Install the CLI

Each forge requires its own CLI tool:

#### GitHub (gh)
brew install gh
gh auth login

#### GitLab (glab)
brew install glab
glab auth login

#### Gitea/Forgejo (tea)
brew install tea
tea login add

### 2. Configure Authentication

For self-hosted instances:

glab auth login --hostname gitlab.company.com
tea login add --name company --url https://gitea.example.com
```

---

## ⚠️ Limitations actuelles

### Pas de UI Settings pour :
- ❌ Voir quels forges sont configurés
- ❌ Status connexion (connecté/déconnecté)
- ❌ Bouton "Connect" pour lancer l'auth
- ❌ Switch pour activer/désactiver un forge
- ❌ Configuration self-hosted via UI

### Ce qui manque vs Providers :
```typescript
// Ce qui existe pour agents
<Switch checked={enabled} onChange={...} />
<Button>Connect</Button>
<StatusDot tone={connected ? 'success' : 'pending'} />

// Ce qui n'existe PAS pour forges
// Aucune carte "GitHub", "GitLab", etc.
```

---

## 🔧 Impact utilisateur

### Expérience actuelle

**Bon :**
- ✅ Zero config si CLIs déjà configurés
- ✅ Détection automatique
- ✅ Pas de duplication de config

**Mauvais :**
- ❌ Pas de visibilité dans l'UI
- ❌ Erreurs CLI cryptiques
- ❌ Pas de guidance pour self-hosted

### Exemple d'erreur typique

```
Utilisateur : "Pourquoi l'onglet GitLab ne marche pas ?"

Debug actuel :
1. Ouvrir terminal
2. Taper `glab auth status`
3. Voir "not logged in"
4. Taper `glab auth login`
5. Relancer cezar

Debug idéal (avec Settings) :
1. Settings → Forges
2. Voir "GitLab: Not connected"
3. Cliquer "Connect"
4. Suivre le flow
```

---

## 💡 Recommandations

### Option A : Garder l'architecture actuelle
**Pro :**
- Simple, pas de duplication
- Délègue la complexité aux CLIs
- Zero maintenance

**Con :**
- Pas de visibilité utilisateur
- Pas cohérent avec Providers

### Option B : Ajouter une section Forges dans Settings
**Fichier à créer :** `packages/web/src/routes/settings/forges-section.tsx`

**Similaire à :** `provider-settings.tsx`

**Fonctionnalités :**
```typescript
export const FORGES = [
  { id: 'github', label: 'GitHub', cli: 'gh', command: 'gh auth login' },
  { id: 'gitlab', label: 'GitLab', cli: 'glab', command: 'glab auth login' },
  { id: 'gitea', label: 'Gitea', cli: 'tea', command: 'tea login add' },
  { id: 'forgejo', label: 'Forgejo', cli: 'tea', command: 'tea login add' },
] as const

// Pour chaque forge :
// - Status : Connected / Not connected / Not installed
// - Bouton : Check again / Connect
// - Hint : Instructions pour self-hosted
```

**Endpoints à ajouter :**
```typescript
GET /api/v1/forges/status
→ { forges: [{ kind: 'github', status: 'connected', available: true }, ...] }

POST /api/v1/forges/:kind/connect
→ Lance le CLI auth flow
```

---

## 🎯 Conclusion

### État actuel : ❌ Pas de configuration dans Settings

**Ce qui existe :**
- ✅ Settings → Providers (pour les agents : Claude, Codex, etc.)
- ❌ Settings → Forges (n'existe pas)

**Configuration des forges :**
- Par CLI uniquement (`gh`, `glab`, `tea`)
- Détection automatique depuis git remote
- Aucune UI dans Settings

**Recommandation :**
Pour une expérience utilisateur cohérente, **ajouter une section Forges** dans Settings, similaire à Providers, avec :
- Cartes pour GitHub, GitLab, Gitea, Forgejo
- Status de connexion
- Boutons Connect/Check again
- Instructions self-hosted

**Priorité :** Moyenne
- Le système fonctionne sans
- Mais l'UX serait meilleure avec

---

*Vérification effectuée le : 7 octobre 2026*  
*URL testée : http://localhost:4321/settings/global*  
*Fichiers analysés : provider-settings.tsx, registry.tsx, forge drivers*
