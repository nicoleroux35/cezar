# Queue Reordering Feature

Cette fonctionnalité permet aux utilisateurs de réorganiser manuellement l'ordre des tâches en file d'attente avec drag & drop ou boutons.

## Vue d'ensemble

Par défaut, les tâches en file d'attente sont traitées dans l'ordre FIFO (First In, First Out) basé sur leur date de création. Cette fonctionnalité permet de changer cet ordre en assignant un timestamp personnalisé (`queuePosition`) à chaque tâche.

## Implémentation

### Backend

1. **Nouveau champ dans le schéma** (`packages/contract/src/runs.ts`, `packages/cezar/src/runs/store.ts`)
   - `queuePosition?: string` - Timestamp ISO-8601 optionnel qui remplace `createdAt` pour le tri de la file d'attente
   - Absent sur les tâches qui utilisent l'ordre naturel de création

2. **Nouveau endpoint API** (`packages/cezar/src/server/server.ts`)
   - `POST /api/v1/runs/reorder-queue`
   - Corps : `{ runIds: string[] }` - Tableau d'IDs dans l'ordre désiré
   - Réponse : `{ reordered: true, count: number }`
   - Valide que toutes les tâches existent et sont en statut `queued`

3. **Méthode du store** (`packages/cezar/src/runs/store.ts`)
   - `reorderQueue(runIds: string[]): number`
   - Assigne des timestamps `queuePosition` décroissants pour maintenir l'ordre
   - Persiste les changements et diffuse via SSE

4. **Logique de la file d'attente** (`packages/cezar/src/workflows/run.ts`)
   - Le `RunManager` utilise `queuePosition ?? createdAt` pour trier la file d'attente
   - `oldestQueuedAt()` respecte le champ personnalisé

### Frontend

1. **Fonction de tri mise à jour** (`packages/web/src/lib/task-groups.ts`)
   - `queuePositions()` et `sortRuns()` utilisent `queuePosition ?? createdAt`
   - Les numéros de position reflètent l'ordre réel d'exécution

2. **Client API** (`packages/web/src/api/client.ts`)
   - `reorderQueue(runIds: string[]): Promise<{reordered: true, count: number}>`

3. **Composants UI avec Drag & Drop**
   - **`QueueManager`** - Version simple avec boutons haut/bas
   - **`QueueManagerDnd`** - Version avec drag & drop basique
   - **`QueueManagerAdvanced`** - Version complète avec overlay et animations fluides ⭐
   - **`QueueWidget`** - Widget compact pour sidebar/dashboard
   - **`QueueReorderButtons`** - Boutons réutilisables pour réorganisation manuelle
   - **`useQueueReorder`** - Hook personnalisé avec logique `moveUp`/`moveDown`

## Utilisation

### Option 1 : Panneau avancé avec Drag & Drop (Recommandé) ⭐

Le composant le plus complet avec drag & drop, overlay visuel et animations :

```tsx
import { QueueManagerAdvanced } from '@/components/queue-manager-advanced'

function TasksView() {
  return (
    <div>
      <h2>Gérer la file d'attente</h2>
      <QueueManagerAdvanced />
    </div>
  )
}
```

**Fonctionnalités :**
- ✅ Glisser-déposer avec retour visuel
- ✅ Overlay montrant l'élément déplacé
- ✅ Restriction au mouvement vertical uniquement
- ✅ Accessible au clavier (Flèches + Espace/Entrée)
- ✅ Compatible tactile avec distance d'activation

### Option 2 : Widget compact pour sidebar

Version minimaliste parfaite pour les espaces restreints :

```tsx
import { QueueWidget } from '@/components/queue-widget'

function Sidebar() {
  return (
    <aside>
      <QueueWidget />
    </aside>
  )
}
```

**Fonctionnalités :**
- Design compact et minimal
- Poignées de drag visibles au survol
- Défilement automatique pour longues listes
- Badge de comptage

### Option 3 : Drag & Drop simple

Version intermédiaire sans overlay :

```tsx
import { QueueManagerDnd } from '@/components/queue-manager-dnd'

function QueuePage() {
  return <QueueManagerDnd />
}
```

### Option 4 : Boutons manuels (sans drag & drop)

Pour les utilisateurs qui préfèrent les boutons :

```tsx
import { QueueManager } from '@/components/queue-manager'

function QueuePage() {
  return <QueueManager />
}
```

### Option 5 : Boutons intégrés dans les lignes de tableau

Pour intégrer les boutons de réorganisation directement dans la vue d'ensemble des tâches :

```tsx
import { QueueReorderButtons } from '@/components/queue-reorder-buttons'
import { useQueueReorder } from '@/lib/use-queue-reorder'

function TaskRow({ run, allRuns }) {
  const { moveUp, moveDown, isPending } = useQueueReorder()
  
  if (run.status !== 'queued') return <NormalRow run={run} />
  
  const queued = allRuns.filter(r => !r.archived && r.status === 'queued')
  const index = queued.findIndex(r => r.id === run.id)
  
  return (
    <tr>
      {/* ... autres cellules ... */}
      <td>
        <QueueReorderButtons
          canMoveUp={index > 0}
          canMoveDown={index < queued.length - 1}
          onMoveUp={() => moveUp(allRuns, run.id)}
          onMoveDown={() => moveDown(allRuns, run.id)}
          disabled={isPending}
        />
      </td>
    </tr>
  )
}
```

## Fonctionnalités du Drag & Drop

### Accessibilité
- **Clavier** : Utilisez les touches fléchées pour déplacer, Espace/Entrée pour sélectionner
- **Lecteurs d'écran** : Annonces ARIA complètes pour toutes les actions
- **Touch** : Supporte les gestes tactiles sur mobile/tablette

### Retour visuel
- **Overlay** : Aperçu de l'élément pendant le déplacement (version Advanced)
- **Opacité** : L'élément d'origine devient transparent pendant le drag
- **Cursor** : Change de `grab` à `grabbing` pendant le déplacement
- **Hover** : Mise en évidence de la zone de dépôt

### Contraintes
- **Mouvement vertical uniquement** : Empêche les déplacements horizontaux accidentels
- **Distance d'activation** : 5-8px requis avant de déclencher le drag (évite les drags accidentels)
- **Conteneur restreint** : Le drag ne peut pas sortir du panneau

## Comportement

- **Compatibilité ascendante** : Les tâches sans `queuePosition` utilisent leur `createdAt` (comportement par défaut)
- **Validation** : Seules les tâches avec `status === 'queued'` peuvent être réorganisées
- **Persistance** : L'ordre personnalisé survit aux redémarrages
- **Invalidation** : Quand une tâche démarre, son `queuePosition` n'a plus d'effet
- **SSE** : Les changements sont diffusés en temps réel aux clients connectés
- **Feedback immédiat** : L'UI se met à jour instantanément, puis synchronise avec le serveur

## Tests

Pour tester :

1. Créer plusieurs tâches qui seront mises en file d'attente (ex : avec `maxParallel: 1`)
2. Ouvrir un des composants de gestion de file d'attente
3. **Drag & Drop** : Cliquer et glisser une tâche vers une nouvelle position
4. **Clavier** : Sélectionner une tâche avec Tab, puis utiliser les flèches pour la déplacer
5. **Boutons** : Cliquer sur les boutons haut/bas
6. Vérifier que l'ordre d'exécution suit le nouvel ordre

## Dépendances

Le drag & drop utilise `@dnd-kit`, déjà présent dans le projet :
- `@dnd-kit/core` - Logique principale
- `@dnd-kit/sortable` - Stratégies de tri
- `@dnd-kit/utilities` - Utilitaires (transformations CSS)

## Développement futur

Améliorations potentielles :

- ✅ Drag & drop visuel (Implémenté)
- ✅ Overlay pendant le drag (Implémenté)
- ✅ Support clavier complet (Implémenté)
- ✅ Version compacte pour sidebar (Implémenté)
- ⬜ Déplacer vers le début/fin de la file (boutons rapides)
- ⬜ Réorganisation par lots (sélection multiple)
- ⬜ Historique des réorganisations avec undo
- ⬜ Auto-scroll pendant le drag pour longues listes
- ⬜ Groupage/catégorisation des tâches en file d'attente
