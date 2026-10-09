# 🚀 Guide de Démarrage Rapide - Réorganisation de la File d'Attente

## Installation

Aucune installation requise ! Tous les fichiers ont été créés et la bibliothèque `@dnd-kit` est déjà présente dans le projet.

## Utilisation en 3 minutes

### 1️⃣ Importer le composant

Dans n'importe quel fichier React :

```tsx
import { QueueManagerAdvanced } from '@/components/queue-manager-advanced'

export function MyView() {
  return (
    <div className="p-6">
      <QueueManagerAdvanced />
    </div>
  )
}
```

C'est tout ! Le composant :
- ✅ Récupère automatiquement les tâches en file d'attente
- ✅ Affiche les tâches avec drag & drop fonctionnel
- ✅ Sauvegarde automatiquement les changements
- ✅ Synchronise via SSE en temps réel

### 2️⃣ (Optionnel) Ajouter une route

Pour avoir une page dédiée, ajoutez dans votre routeur :

```tsx
// Dans votre fichier de routes (ex: routes.tsx)
import { QueueManagementPage } from '@/routes/queue-management-page'

// Ajouter la route
{
  path: '/queue',
  element: <QueueManagementPage />
}
```

### 3️⃣ (Optionnel) Widget dans la sidebar

Pour un petit widget dans la sidebar :

```tsx
import { QueueWidget } from '@/components/queue-widget'

function Sidebar() {
  return (
    <aside className="w-64 space-y-4">
      {/* Autres widgets */}
      <QueueWidget />
    </aside>
  )
}
```

## Choisir le bon composant

| Composant | Quand l'utiliser | Taille |
|-----------|------------------|--------|
| `QueueManagerAdvanced` ⭐ | Page principale, espace disponible | Grande |
| `QueueWidget` | Sidebar, dashboard | Compacte |
| `QueueManagerDnd` | Alternative simple sans overlay | Moyenne |
| `QueueManager` | Pas de drag & drop (boutons uniquement) | Moyenne |
| `QueueReorderButtons` | Intégration dans tableau existant | Mini |

## Tests rapides

### Test 1 : Drag & Drop
```bash
1. Créer 3-4 tâches (elles vont en file d'attente si maxParallel=1)
2. Ouvrir le QueueManagerAdvanced
3. Glisser une tâche vers le haut ou le bas
4. ✅ L'ordre change immédiatement
```

### Test 2 : Clavier
```bash
1. Ouvrir le QueueManagerAdvanced
2. Appuyer sur Tab pour sélectionner une tâche
3. Utiliser les flèches ↑/↓ pour la déplacer
4. Appuyer sur Espace pour la "saisir" et encore pour la "déposer"
5. ✅ Fonctionne sans souris
```

### Test 3 : Synchronisation
```bash
1. Ouvrir deux onglets sur la même page
2. Réorganiser dans le premier onglet
3. ✅ Le deuxième onglet se met à jour automatiquement
```

## Personnalisation

### Changer les styles

Tous les composants utilisent Tailwind. Exemple :

```tsx
<QueueManagerAdvanced />

// Ajouter une classe wrapper
<div className="max-w-2xl mx-auto">
  <QueueManagerAdvanced />
</div>
```

### Hook pour logique personnalisée

```tsx
import { useQueueReorder } from '@/lib/use-queue-reorder'
import { useRuns } from '@/api/queries'

function CustomComponent() {
  const { data: runs } = useRuns()
  const { moveUp, moveDown, isPending } = useQueueReorder()
  
  return (
    <div>
      {runs?.filter(r => r.status === 'queued').map(run => (
        <div key={run.id}>
          {run.title}
          <button onClick={() => moveUp(runs, run.id)}>↑</button>
          <button onClick={() => moveDown(runs, run.id)}>↓</button>
        </div>
      ))}
    </div>
  )
}
```

## Résolution de problèmes

### Les tâches ne bougent pas ?
- ✅ Vérifier que les tâches sont en statut `queued` (pas `running` ou `done`)
- ✅ Vérifier la console pour les erreurs API

### Le drag & drop ne fonctionne pas ?
- ✅ S'assurer que `@dnd-kit/*` est installé : `npm list @dnd-kit/core`
- ✅ Vérifier qu'il n'y a pas de `pointer-events: none` en CSS

### Les changements ne persistent pas ?
- ✅ Vérifier que l'endpoint `/api/v1/runs/reorder-queue` répond 200
- ✅ Regarder le réseau dans DevTools

## Fichiers importants

```
Backend:
  packages/contract/src/runs.ts              # Schémas
  packages/cezar/src/runs/store.ts           # Logique de réorganisation
  packages/cezar/src/server/server.ts        # Endpoint API

Frontend:
  packages/web/src/components/
    ├── queue-manager-advanced.tsx           # ⭐ Version complète
    ├── queue-widget.tsx                     # Version compacte
    ├── queue-manager-dnd.tsx                # Version simple
    ├── queue-manager.tsx                    # Version boutons
    └── queue-reorder-buttons.tsx            # Composant réutilisable
  
  packages/web/src/lib/
    ├── use-queue-reorder.ts                 # Hook personnalisé
    └── task-groups.ts                       # Logique de tri (modifié)
  
  packages/web/src/api/client.ts             # Client API (modifié)

Documentation:
  packages/web/QUEUE_REORDERING.md           # Guide complet
  IMPLEMENTATION_SUMMARY.md                   # Résumé technique
```

## Support

Pour plus d'informations :
- 📖 Guide complet : `packages/web/QUEUE_REORDERING.md`
- 🏗️ Détails techniques : `IMPLEMENTATION_SUMMARY.md`
- 💡 Exemple de page : `packages/web/src/routes/queue-management-page.tsx`

## Checklist de déploiement

Avant de déployer en production :

- [ ] Tester avec plusieurs tâches (5-10+)
- [ ] Tester le drag & drop sur desktop
- [ ] Tester le tactile sur mobile/tablette
- [ ] Tester l'accessibilité clavier
- [ ] Tester avec deux onglets ouverts (SSE)
- [ ] Vérifier qu'aucune erreur console
- [ ] Vérifier que l'ordre d'exécution est correct
- [ ] Tester un redémarrage du serveur (persistance)

---

**Vous êtes prêt !** 🎉

Le système fonctionne immédiatement sans configuration. Importez simplement le composant et commencez à réorganiser vos tâches.
