# Guide de contribution au serveur MCP Cezar

## Vue d'ensemble

Le serveur MCP (`packages/mcp-server`) expose les fonctionnalités de cezar via le protocole MCP (Model Context Protocol), permettant aux clients MCP comme Claude Desktop, Cline, ou Continue de contrôler cezar.

## Architecture du code

```
packages/mcp-server/
├── src/
│   └── index.ts              # Point d'entrée du serveur MCP
├── dist/                     # Code compilé (généré par tsc)
├── package.json
├── tsconfig.json
├── README.md                 # Documentation utilisateur
├── INSTALL.md                # Guide d'installation détaillé
├── EXAMPLES.md               # Exemples d'utilisation
├── test-mcp.js              # Script de test manuel
└── claude_desktop_config.example.json
```

## Comment ajouter un nouvel outil

1. **Définir l'outil dans `TOOLS`** :

```typescript
{
  name: 'cezar_nouveau_outil',
  description: 'Description claire de ce que fait l\'outil',
  inputSchema: {
    type: 'object',
    properties: {
      parametre: {
        type: 'string',
        description: 'Description du paramètre',
      },
    },
    required: ['parametre'],
  },
}
```

2. **Implémenter le handler dans `handleToolCall`** :

```typescript
case 'cezar_nouveau_outil': {
  const parametre = args.parametre as string;
  const result = await cezarApi(`/api/v1/p/${PROJECT_ID}/endpoint`, {
    method: 'POST',
    body: JSON.stringify({ parametre }),
  });
  return result;
}
```

3. **Documenter dans README.md et EXAMPLES.md**

4. **Tester** :

```bash
npm run build:mcp
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

2. **Implémenter dans `readResource()`** :

```typescript
case '/nouvelle-ressource': {
  const data = await cezarApi(`/api/v1/p/${PROJECT_ID}/endpoint`);
  return JSON.stringify(data, null, 2);
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
const task = await cezarApi(`/api/v1/p/${PROJECT_ID}/runs/${taskId}`);
return task;
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

Utiliser les types du contrat quand c'est possible :

```typescript
import type { RunRecord, RunStatus } from '@open-mercato/cezar-contract';
```

### 4. Configuration

Utiliser les variables d'environnement pour la configuration :

```typescript
const CEZAR_URL = process.env.CEZAR_URL || DEFAULT_CEZAR_URL;
const PROJECT_ID = process.env.CEZAR_PROJECT_ID || 'default';
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

### Tests avec un vrai client MCP

1. Compiler : `npm run build:mcp`
2. Configurer Claude Desktop (voir INSTALL.md)
3. Tester dans Claude Desktop

### Tests d'intégration

Pour ajouter des tests d'intégration automatisés :

1. Créer `packages/mcp-server/src/index.test.ts`
2. Utiliser vitest
3. Mocker les appels à l'API cezar

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('MCP Server', () => {
  it('should list tools', async () => {
    // Test...
  });
});
```

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

- [ ] Code compilé sans erreurs : `npm run build:mcp`
- [ ] Tests manuels passés avec test-mcp.js
- [ ] Documentation mise à jour (README.md, EXAMPLES.md si pertinent)
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
