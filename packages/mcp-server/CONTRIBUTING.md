# Guide de contribution au serveur MCP Cezar

## Vue d'ensemble

Le serveur MCP (`packages/mcp-server`) expose les fonctionnalités de cezar via le protocole MCP (Model Context Protocol), permettant aux clients MCP comme Claude Desktop, Cline, ou Continue de contrôler cezar.

## Architecture du code

```
packages/mcp-server/
├── src/
│   ├── endpoints.ts          # La table des routes appelées (voir ci-dessous)
│   └── index.ts              # Point d'entrée du serveur MCP
├── dist/                     # Code compilé (généré par tsc)
├── package.json
├── tsconfig.json
├── README.md                 # Documentation utilisateur
├── INSTALL.md                # Guide d'installation détaillé
├── EXAMPLES.md               # Exemples d'utilisation
├── COVERAGE.md               # Les outils, un par un
├── test-mcp.js              # Script de test manuel
└── claude_desktop_config.example.json
```

## Les URL sont des données, pas des chaînes en ligne

C'est la règle qui gouverne tout le reste. Chaque route que ce serveur appelle vit dans
[`src/endpoints.ts`](./src/endpoints.ts) :

```typescript
runs: { method: 'GET', path: `/api/v1/p/${PROJECT}/runs` },
```

`{projectId}` est rempli par `PROJECT` (l'id du projet visé), les autres accolades par les
paramètres de chemin de l'outil — c'est `fillPath` qui substitue et encode. Un outil n'écrit jamais
l'URL lui-même : il désigne l'entrée (`ENDPOINTS.runs`) et passe ses paramètres.

Pourquoi cette indirection : sans elle, renommer une route côté cezar transforme l'outil en 404
silencieux — ce qui est arrivé à plus de vingt outils avant 2026-10-11. Avec elle,
`packages/cezar/src/server/mcp-endpoint-drift.test.ts` confronte chaque entrée à la table de
routes d'une app **construite** (`app.routes`, la même source que `bc-route-inventory.test.ts`) et
le renommage fait échouer un test.

## Comment ajouter un nouvel outil

1. **Ajouter sa route dans `src/endpoints.ts`** :

```typescript
nouvelOutil: { method: 'POST', path: `/api/v1/p/${PROJECT}/endpoint` },
```

Une route projet passe par `PROJECT` (`/api/v1/p/{projectId}/…`) — c'est ce qui permet au serveur de
nommer le projet qu'il vise plutôt que de subir celui dans lequel le cockpit a démarré. Les
familles d'espace de travail (santé, `/models`, registre de projets, `/workspace/*`) n'ont qu'un
seul montage et s'écrivent en clair (`/api/v1/projects`). Le garde de dérive tient la liste exacte
des routes non scopées : y ajouter une route qui devrait être scopée fait échouer le test.

2. **Déclarer l'outil dans `TOOLS`** (le schéma est du JSON Schema, c'est ce que `tools/list`
   renvoie et ce que votre client MCP affiche) :

```typescript
{
  name: 'cezar_nouveau_outil',
  description: 'Description claire de ce que fait l\'outil',
  inputSchema: {
    type: 'object',
    properties: {
      parametre: { type: 'string', description: 'Description du paramètre' },
    },
    required: ['parametre'],
  },
}
```

**Décrivez la forme réelle, pas `{ type: 'object' }`.** Un schéma vide ne dit pas au client que
`id` est requis : il envoie un corps que la route refuse, et l'utilisateur reçoit
`steps.0.id: Invalid input: expected string, received undefined` au premier appel. Quand une
forme revient (une étape de workflow, un filtre d'automation, une planification), elle vit dans une
constante partagée — voir `WORKFLOW_STEP_SCHEMA`, `SCHEDULE_SCHEMA`, `AUTOMATION_FILTERS_SCHEMA`.

3. **Implémenter le handler dans `handleToolCall`** :

```typescript
case 'cezar_nouveau_outil': {
  const parametre = args.parametre as string;
  return cezarApi(ENDPOINTS.nouvelOutil, { body: { parametre } });
}
```

`cezarApi` remplit le chemin, pose le projet, sérialise le corps et décode la réponse selon son
content-type (JSON, ou texte brut pour `GET /runs/:id/diff`). Un statut non-2xx lève une `Error`
portant le message du serveur, que le handler d'erreurs rend en `isError`.

4. **Documenter dans README.md et COVERAGE.md**

5. **Tester** :

```bash
npm run build:mcp
npm test -- packages/cezar/src/server/mcp-endpoint-drift.test.ts   # le garde de dérive
node packages/mcp-server/test-mcp.js call-tool cezar_nouveau_outil '{"parametre":"test"}'
```

## Comment ajouter une nouvelle ressource

1. **Ajouter à `listResources()`** :

```typescript
{
  uri: `cezar://nouvelle-ressource`,
  name: 'Nom de la ressource',
  description: 'Description de la ressource',
  mimeType: 'application/json',
}
```

2. **Implémenter dans `readResource()`** — attention, `new URL('cezar://tasks')` lit `tasks` comme
le HOST et laisse `pathname` vide : ne testez pas `pathname`, découpez après le schéma.

```typescript
const path = uri.startsWith(RESOURCE_SCHEME) ? uri.slice(RESOURCE_SCHEME.length) : uri;
const [head, second] = path.split('/').filter((part) => part.length > 0);
switch (head) {
  case 'nouvelle-ressource': { /* … */ }
  default: throw new Error(`Unknown resource: ${uri}`);
}
```

3. **Tester** :

```bash
node packages/mcp-server/test-mcp.js read-resource cezar://nouvelle-ressource
```

## Principes de conception

### 1. Simplicité

Le serveur est un **proxy simple** entre MCP et l'API HTTP de cezar. Il ne contient pas de logique métier.

❌ Mauvais :
```typescript
// Ne pas implémenter la logique dans le serveur MCP
if (task.status === 'waiting') {
  // Logique complexe...
}
```

✅ Bon :
```typescript
// Déléguer à l'API cezar
return cezarApi(ENDPOINTS.runs, { params: { id: taskId } });
```

### 2. Gestion d'erreurs

Toutes les erreurs doivent être capturées et retournées proprement :

```typescript
try {
  const result = await handleToolCall(name, args);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}
```

### 3. Typage

Pas de `@ts-nocheck` : `src/index.ts` est vérifié par `npm run typecheck:mcp`. Les identifiants de
backend (`RUNNER_IDS`, `MODEL_DISCOVERY_RUNNERS`) et les statuts de run (`RUN_STATUSES`) sont des
`as const` qui doivent rester alignés sur leurs sources côté cezar — un `as const` désynchronisé ne
casse rien au compilateur, seulement l'utilisateur, donc vérifiez-les à la main quand vous y
touchez.

### 4. Configuration

Utiliser les variables d'environnement pour la configuration (les alias historiques restent
acceptés, le nom moderne gagne) :

```typescript
const CEZAR_URL = process.env.CEZ_API_URL || process.env.CEZAR_URL || DEFAULT_CEZAR_URL;
const PROJECT_ID = process.env.CEZ_PROJECT_ID || process.env.CEZAR_PROJECT_ID || 'default';
```

## Tests

### Tests manuels avec test-mcp.js

```bash
# Lister les outils
node test-mcp.js list-tools

# Tester la santé
node test-mcp.js call-tool cezar_get_health

# Créer une tâche
node test-mcp.js call-tool cezar_create_task '{"task":"Test"}'
```

### Tests automatisés

Il n'y a pas de suite vitest *dans* `packages/mcp-server` (le serveur n'a pas de logique métier à
tester — il traduit un appel MCP en un appel HTTP). Ce qu'il faut tester, c'est que cette
traduction vise des routes qui existent, et ce test vit à côté de la table de routes qu'il lit :

```bash
npm test -- packages/cezar/src/server/mcp-endpoint-drift.test.ts
```

Il vérifie, contre une app **construite** :

- chaque entrée de `ENDPOINTS` a une route enregistrée (`{x}` et `:x` normalisés avant comparaison) ;
- chaque entrée est référencée dans `src/index.ts` — une entrée morte est aussi une dérive ;
- l'ensemble des routes non scopées est exactement la liste attendue (santé, `/models`,
  `/agent-config`, registre de projets, `/workspace/*`) : une route projet qui perd son préfixe
  `/p/:projectId` se ferait prendre ici ;
- `fillPath` substitue, encode (`a/b` → `a%2Fb`) et lève sur un paramètre manquant.

Deux limites, à connaître : le garde compare **chemins et méthodes, pas les corps de requête** —
un outil qui poste `{ message }` là où la route attend `{ text }` lui échappe (cette classe se
voit en lisant le schéma zod de la route) ; et il ne vérifie pas que la réponse correspond au
schéma du contrat.

Le garde est non-vacuous : il refuse de passer si la table de routes lue est trop petite
(`registeredRoutes.size > 100`) ou si aucune route MCP n'a été trouvée.

### Le garde de dérive documentaire

Le test ci-dessus tient les **routes** ; il ne dit rien des **compteurs**. C'est par là que la doc a
dérivé : README et COVERAGE annonçaient 63 outils quand le serveur en exposait 81. Un second garde
compare ce que le serveur **annonce** à ce que la doc **écrit** :

```bash
npm run build:mcp          # le garde lit dist/index.js
npm -w @open-mercato/cezar-mcp-server run check:coverage
```

Il démarre le serveur construit sur stdio, demande `tools/list` et `resources/list` (aucun cockpit
nécessaire : ces deux appels ne touchent pas l'API), puis vérifie que le TOTAL de COVERAGE.md et le
« **N outils** » de README.md valent le nombre annoncé, que chaque outil documenté est annoncé et
réciproquement, que le compte de ressources concorde, et que la description de COVERAGE.md commence
par celle de l'outil (la doc peut ajouter une mise en garde, pas garder une formulation que le code
a changée). **Ajouter un outil veut donc dire ajouter sa ligne dans COVERAGE.md, et corriger les
compteurs dans README.md** — sinon ce garde échoue.

### Tests manuels avec un vrai client MCP

1. Compiler : `npm run build:mcp`
2. Configurer Claude Desktop (voir INSTALL.md)
3. Tester dans Claude Desktop

`CEZ_DRY_RUN=1 npm run dev` (à la racine) donne un cockpit complet sans agent réel, sur lequel
`test-mcp.js` et un client MCP peuvent travailler de bout en bout.

## Débogage

### Logs stderr

Le serveur MCP utilise stderr pour les logs (stdout est réservé au protocole MCP) :

```typescript
console.error('Debug info:', someData);
```

### Vérifier les logs Claude Desktop

- macOS : `~/Library/Logs/Claude/mcp*.log`
- Linux : `~/.config/Claude/logs/`
- Windows : `%APPDATA%\Claude\logs\`

### Mode verbose

Pour activer plus de logs :

```typescript
const DEBUG = process.env.DEBUG === '1';
if (DEBUG) console.error('Debug:', data);
```

## Conventions de code

### Nommage

- Outils : `cezar_action_objet` (ex: `cezar_create_task`)
- Ressources : `cezar://objet[/id]` (ex: `cezar://tasks/abc123`)
- Fonctions : camelCase

### Formatage

Le projet utilise les conventions TypeScript standard. Suivez le style du code existant.

### Commentaires

Documenter les fonctions complexes avec JSDoc :

```typescript
/**
 * Gère un appel d'outil MCP
 * @param name - Nom de l'outil
 * @param args - Arguments de l'outil
 * @returns Résultat de l'outil
 */
async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  // ...
}
```

## Checklist pour une PR

- [ ] Route ajoutée dans `src/endpoints.ts` (jamais une URL en ligne)
- [ ] `npm run typecheck:mcp` sans erreur (pas de `@ts-nocheck`)
- [ ] `npm run build:mcp` sans erreur
- [ ] `npm test -- packages/cezar/src/server/mcp-endpoint-drift.test.ts` vert
- [ ] `npm -w @open-mercato/cezar-mcp-server run check:coverage` vert (ligne dans COVERAGE.md,
      compteurs de README.md et d'API_REFERENCE.md à jour)
- [ ] Schéma d'entrée décrivant la forme réelle (pas `{ type: 'object' }`)
- [ ] Tests manuels passés avec test-mcp.js (au moins un appel réel par outil ajouté)
- [ ] Documentation mise à jour (README.md, COVERAGE.md, API_REFERENCE.md)
- [ ] Code formaté et commenté
- [ ] Pas de secrets ou credentials en dur
- [ ] Variables d'environnement documentées dans INSTALL.md
- [ ] Testé avec au moins un client MCP (Claude Desktop, Cline, etc.)

## Roadmap

### Fonctionnalités à venir

1. **Streaming en temps réel** - Utiliser SSE pour streamer les événements
2. **Support multi-projets** - Permettre de changer de projet dynamiquement
3. **Upload de fichiers** - Supporter les attachments via MCP
4. **Prompts MCP** - Questions interactives pour l'utilisateur
5. **Notifications** - Notifier proactivement le client des changements

### Comment contribuer à la roadmap

1. Ouvrir une issue décrivant la fonctionnalité
2. Discuter l'approche dans l'issue
3. Créer une branche feature
4. Implémenter avec tests
5. Ouvrir une PR avec référence à l'issue

## Ressources

- [Spécification MCP](https://modelcontextprotocol.io/)
- [SDK MCP TypeScript](https://github.com/modelcontextprotocol/typescript-sdk)
- [API HTTP Cezar](../../packages/contract/src/)
- [Documentation Cezar](../../docs/reference.md)

## Questions ?

- Ouvrir une issue GitHub
- Discuter dans les discussions GitHub
- Consulter AGENTS.md à la racine pour l'architecture globale de cezar
