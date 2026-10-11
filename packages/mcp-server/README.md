# Cezar MCP Server

Serveur MCP (Model Context Protocol) qui expose le cockpit cezar à un client MCP — Claude Desktop,
Cline, Continue, ou n'importe quel autre hôte MCP.

Un outil MCP = **un appel HTTP** vers le cockpit (`http://127.0.0.1:4321` par défaut), et la réponse
JSON est rendue telle quelle. Il n'y a ni cache, ni état, ni base : tout ce que ce serveur sait faire
est ce que l'API cezar sait faire.

## Ce que ça expose

**81 outils** et **11 ressources**, sur les surfaces suivantes :

| Surface | Outils | Ce que ça couvre |
| --- | --- | --- |
| Tâches | 31 | créer (variantes ×2/×3, autonome, dispatch, file d'attente), lister, éditer, archiver, épingler, lu/non-lu, message, annuler, terminer, continuer, diff, commits, changes, commit, push, PR, worktree — plus la file d'attente (démarrer, réordonner, éditer/supprimer un message en attente) et le dossier d'une tâche (historique, contexte, handoff) |
| Variantes | 2 | lire un groupe ×2/×3, choisir le gagnant |
| Workflows | 8 | lister, lire, créer, remplacer, supprimer — plus l'aide à l'écriture : catalogue de nœuds, validation d'un YAML, validation d'un graphe |
| Skills | 2 | lister, lire — **lecture seule** (voir Limitations) |
| Projets | 5 | lister, lire, ajouter un dossier, retirer, modifier (tags, `maxParallel`) |
| Forge (GitHub…) | 4 | issues ouvertes, PR ouvertes, recherche tous états, statut de référence |
| Trackers (Jira, Linear) | 4 | lister, rechercher, lire un item, état de la connexion |
| Automations | 7 | lister, lire, créer, modifier, activer/pauser, lancer, supprimer |
| Dashboard | 5 | vue workspace, overview, coûts, insights, index des tâches |
| Git & repo | 9 | info repo, status, branches (une seule route `GET /repo` sert les trois) — plus l'exploration : arbre des fichiers, lecture d'un fichier, diff, changes, un commit, création/bascule de branche |
| Config agents | 3 | fichiers de config des agents, profils de compte, modèles découverts |
| Système | 1 | santé, capacités, agents disponibles |

Les **11 ressources** (`cezar://…`) sont des lectures en lecture seule d'un bloc : `tasks`,
`tasks/active`, `tasks/needs-attention`, `workflows`, `skills`, `projects`, `dashboard`,
`github/issues`, `github/prs`, `automations`, `health`. Le même lecteur répond aussi à
`cezar://tasks/<id>` pour une tâche précise (forme non déclarée dans `resources/list`).

## Installation

```bash
# 1. Builder (depuis la racine du dépôt)
npm install
npm run build:mcp

# 2. Déclarer le serveur à Claude Desktop — ~/.config/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "cezar": {
      "command": "node",
      "args": ["/chemin/absolu/vers/cezar/packages/mcp-server/dist/index.js"]
    }
  }
}
```

Aucune variable d'environnement n'est nécessaire : le port par défaut (`4321`) est celui de cezar,
et le projet par défaut est `default`. Voir [INSTALL.md](./INSTALL.md) pour les autres clients.

## Configuration

| Variable | Défaut | Description |
| --- | --- | --- |
| `CEZ_API_URL` | `http://127.0.0.1:4321` | URL du cockpit |
| `CEZAR_URL` | — | Alias historique de `CEZ_API_URL` |
| `CEZ_PROJECT_ID` | `default` | Projet visé par les routes `/api/v1/p/:projectId/…` |
| `CEZAR_PROJECT_ID` | — | Alias historique de `CEZ_PROJECT_ID` |

`CEZ_API_URL` et `CEZ_PROJECT_ID` sont exactement les variables que cezar exporte dans une tâche
dispatchée : **lancé depuis une tâche cezar, ce serveur MCP cible le cockpit qui l'a lancée, sans
configuration**.

## Exemples

```
"Crée une tâche cezar pour corriger le bug dans login.ts"
"Liste mes tâches en attente de revue"
"Montre-moi le diff de la tâche abc123"
"Crée une tâche ×3 autonome avec le workflow 'review' pour analyser la PR #42"
"Archive toutes mes tâches terminées"

"Crée un workflow 'api-dev' avec 3 étapes : implement, test, document"
"Liste les skills disponibles"

"Liste mes projets cezar"
"Ajoute le projet /home/user/backend"

"Liste les issues GitHub ouvertes"
"Cherche 'auth' parmi les PRs, tous états confondus"

"Crée une automation qui lance une review à chaque PR ouverte"
"Lance l'automation 'daily-health-check' maintenant"

"Combien j'ai dépensé cette semaine ?"
```

Plus de scénarios dans [EXAMPLES.md](./EXAMPLES.md).

## Limitations — ce que ce serveur ne fait PAS

Elles sont volontaires : l'API cezar n'expose pas ces surfaces, et un outil MCP qui pointerait
quand même dessus ne répondrait qu'un 404.

- **Les skills sont en lecture seule.** cezar n'a aucune route d'écriture de skill : un skill est un
  fichier `.md` que l'utilisateur écrit dans `.ai/cezar/skills/`, `.ai/skills/`, etc. Les outils
  `cezar_list_skills` / `cezar_get_skill` lisent le catalogue, ils ne le modifient pas.
- **Pas d'association tracker ↔ tâche.** L'association vit au niveau du projet
  (`GET/PUT /tracker/association`), pas par tâche.
- **Pas de streaming SSE en temps réel.** Un client MCP interroge ; il n'y a pas de notification
  poussée des événements d'une tâche.
- **Pas d'upload de fichier binaire.** Les messages acceptent du texte ; les images passent par le
  composeur du cockpit, pas par MCP.
- **L'écriture de la config des agents nécessite un cockpit local.** `GET /agent-config` répond
  partout ; l'écriture répond 409 quand `localHandoff` est faux (mode distant).
- **Pas de self-update de cezar.**

## Écritures qui touchent votre copie de travail

Presque tout ce serveur écrit dans le worktree d'une tâche. Une exception :

- `cezar_create_repo_branch` **bascule le checkout** du dépôt réel — c'est le bouton « branche » de
  la vue Files, et il fait exactement ça. Un client MCP qui l'appelle déplace la branche sous les
  pieds de l'utilisateur : à n'utiliser qu'à bon escient, et à remettre en place ensuite.

## Un outil renvoie une erreur : que faire ?

Les erreurs de l'API remontent telles quelles, avec le message du serveur :

| Symptôme | Cause probable |
| --- | --- |
| `cezar API error (GET /api/v1/…): 404` + `404 Not Found` | La route n'existe plus côté cezar : le serveur MCP est en retard sur le service (voir Développement) |
| `404` avec `{"error":"not found"}` | La route existe, la ressource non (id de tâche inconnu, etc.) |
| `ECONNREFUSED` | Aucun cockpit sur `CEZ_API_URL` — lancer `cezar serve`, ou corriger le port |
| `400` avec un chemin de champ (`steps.0.id: …`) | Corps invalide : le message nomme le champ attendu |

## Développement

**Les URL sont des données, pas des chaînes en ligne.** Tout endpoint appelé par ce serveur vit dans
[`src/endpoints.ts`](./src/endpoints.ts), et
`packages/cezar/src/server/mcp-endpoint-drift.test.ts` confronte chaque entrée à la table de routes
d'une app construite (`app.routes`). Renommer une route côté cezar fait donc échouer un test, au lieu
de transformer silencieusement l'outil correspondant en 404.

Ajouter un outil = ajouter sa route dans `endpoints.ts`, l'appeler via `ENDPOINTS`, puis
l'implémenter dans `handleToolCall`. Le test de dérive échoue si une entrée n'est appelée nulle part.

```bash
npm run build:mcp        # tsc → dist/
npm run typecheck:mcp    # tsc --noEmit
npm test -- packages/cezar/src/server/mcp-endpoint-drift.test.ts   # le garde de dérive
```

Documentation :

- [INSTALL.md](./INSTALL.md) — installation détaillée, par client
- [EXAMPLES.md](./EXAMPLES.md) — scénarios d'utilisation
- [COVERAGE.md](./COVERAGE.md) — les 81 outils, un par un
- [API_REFERENCE.md](./API_REFERENCE.md) — référence par catégorie
- [CHANGELOG.md](./CHANGELOG.md) — historique
- [CONTRIBUTING.md](./CONTRIBUTING.md) — guide développeur

## Licence

MIT (comme cezar)
