# Fonctionnalité : Add to Queue (Queue-Only Mode)

## 📋 Vue d'ensemble

Cette fonctionnalité permet aux utilisateurs d'ajouter des tâches à la file d'attente sans les démarrer automatiquement. Les tâches sont créées en mode "pausé" et doivent être démarrées manuellement.

## ✨ Fonctionnalités

### 1. Création de tâches pausées
- Nouveau bouton **"Add to queue"** dans le compositeur de tâches (à côté de "Start" et "Plan first")
- Les tâches créées en mode queue-only sont marquées avec `paused: true`
- Elles restent en statut `queued` mais ne sont pas ajoutées à la queue du scheduler
- Toast de confirmation : "Task added to queue — start it manually from the task list"

### 2. Démarrage manuel
- Bouton **"Start"** visible dans la colonne Status pour les tâches pausées
- Route API : `POST /api/v1/runs/:id/start-queued`
- Le bouton affiche "Starting…" pendant le démarrage
- Invalidation automatique de la liste des tâches après le démarrage

### 3. Indicateurs visuels
- Pill "Paused" dans la colonne Status (gris, pas de pulse)
- Note "paused" dans la cellule CPU/Memory (au lieu de "#N in queue")
- Distinction claire entre tâches pausées et tâches en attente normale

## 🏗️ Architecture

### Backend

#### 1. **Contract** (`packages/contract/src/runs.ts`)
```typescript
// Ajout dans createRunInputKeys
queueOnly: z.boolean().optional()

// Ajout dans runRecordSchema
paused: z.boolean().optional()

// Nouveau schema de réponse
export const startQueuedResponseSchema = z.object({ started: z.literal(true) })
export type StartQueuedResponse = z.infer<typeof startQueuedResponseSchema>
```

#### 2. **Store** (`packages/cezar/src/runs/store.ts`)
```typescript
// Ajout du champ paused dans le schema
paused: z.boolean().optional()
```

#### 3. **RunManager** (`packages/cezar/src/workflows/run.ts`)
```typescript
// Dans startRun()
if (input.queueOnly) {
  this.store.updateRun(run.id, { paused: true });
  this.pendingJobs.set(run.id, { workflow, input: effectiveInput });
  // N'appelle pas this.queue.push() ni this.pump()
} else {
  // Comportement normal
}

// Nouvelle méthode
startQueuedRun(runId: string): boolean {
  const run = this.store.getRun(runId);
  if (!run || run.status !== 'queued' || !run.paused) return false;
  if (!this.pendingJobs.has(runId)) return false;
  
  this.store.updateRun(runId, { paused: false });
  this.queue.push(runId);
  void this.pump();
  return true;
}
```

#### 4. **Serveur HTTP** (`packages/cezar/src/server/server.ts`)
```typescript
// Ajout dans startRunSchema
queueOnly: z.boolean().optional()

// Nouvelle route
.post('/runs/:id/start-queued', (c) => {
  const { store, manager } = c.get('project');
  const id = c.req.param('id');
  const run = store.getRun(id);
  if (!run) return c.json({ error: 'not found' }, 404);
  if (run.status !== 'queued') {
    return c.json({ error: `run is not queued (status: ${run.status})` }, 409);
  }
  if (!run.paused) {
    return c.json({ error: 'run is not paused' }, 409);
  }
  const started = manager.startQueuedRun(id);
  if (!started) return c.json({ error: 'failed to start run' }, 500);
  return c.json({ started: true });
})
```

### Frontend

#### 1. **Draft Store** (`packages/web/src/routes/new-task-draft.ts`)
```typescript
export interface NewTaskDraft {
  // ... autres champs
  queueOnly: boolean
}
```

#### 2. **Composant ModeSegment** (`packages/web/src/routes/new-task.tsx`)
```typescript
function ModeSegment({
  planFirst,
  queueOnly,
  planning,
  onModeChange,
}: {
  planFirst: boolean
  queueOnly: boolean
  planning: boolean
  onModeChange: (mode: 'start' | 'plan' | 'queue') => void
})
```

Trois boutons :
- **Start** : Démarre immédiatement
- **Plan first** : Planifie d'abord
- **Add to queue** : Ajoute sans démarrer

#### 3. **API Client** (`packages/web/src/api/client.ts`)
```typescript
export async function startQueuedRun(id: string): Promise<StartQueuedResponse> {
  return unwrap(
    await cez.api.v1.p[':projectId'].runs[':id']['start-queued'].$post({
      param: { projectId: queryScope(), id: encodeURIComponent(id) },
    }),
    runPath(id, '/start-queued'),
  )
}
```

#### 4. **Liste des tâches** (`packages/web/src/routes/tasks-overview.tsx`)
```typescript
// Dans la colonne Status
{run.status === 'queued' && run.paused ? (
  <div className="flex items-center gap-2">
    <Pill dot="muted" pulse={false} title="Paused in queue">
      Paused
    </Pill>
    <StartPausedButton runId={run.id} />
  </div>
) : (
  // Status normal
)}

// Composant StartPausedButton
function StartPausedButton({ runId }: { runId: string }) {
  const start = useMutation({
    mutationFn: async () => {
      const { startQueuedRun } = await import('@/api/client')
      return startQueuedRun(runId)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.all })
      toast('Task started', { tone: 'success' })
    },
    onError: (error: Error) => {
      toast(error.message, { tone: 'danger' })
    },
  })

  return (
    <Button
      size="sm"
      variant="default"
      onClick={(e) => {
        e.stopPropagation()
        start.mutate()
      }}
      disabled={start.isPending}
      className="h-6 px-2 text-xs"
    >
      {start.isPending ? 'Starting…' : 'Start'}
    </Button>
  )
}
```

## 🎯 Cas d'usage

### 1. Préparation de tâches
```
1. Utilisateur va sur /new
2. Sélectionne "Add to queue"
3. Configure la tâche (skill, model, etc.)
4. Clique sur "Add to queue"
5. Toast de confirmation
6. Répète pour plusieurs tâches
```

### 2. Démarrage manuel
```
1. Utilisateur va sur la liste des tâches
2. Voit les tâches avec pill "Paused"
3. Clique sur le bouton "Start" dans la colonne Status
4. La tâche démarre et entre dans la queue normale
```

### 3. Gestion de l'ordre
```
1. Plusieurs tâches pausées créées
2. L'utilisateur peut réordonner avec drag & drop (fonctionnalité existante)
3. Démarre les tâches dans l'ordre désiré
```

## 🔐 Sécurité et validation

### Backend
- Validation du statut : seules les tâches `queued` peuvent être démarrées
- Validation du flag : seules les tâches avec `paused: true` sont acceptées
- Vérification de l'existence du `pendingJob` avant le démarrage

### Frontend
- Le bouton Start n'apparaît que pour les tâches pausées
- Gestion d'erreur complète avec toasts
- État de chargement pendant le démarrage

## 🧪 Tests recommandés

### Backend
```typescript
describe('POST /runs/:id/start-queued', () => {
  it('démarre une tâche pausée', async () => {
    const run = store.createRun({ /* ... */ paused: true })
    const response = await POST(`/runs/${run.id}/start-queued`)
    expect(response.status).toBe(200)
    expect(store.getRun(run.id)?.paused).toBe(false)
  })

  it('refuse une tâche non pausée', async () => {
    const run = store.createRun({ /* ... */ paused: false })
    const response = await POST(`/runs/${run.id}/start-queued`)
    expect(response.status).toBe(409)
  })

  it('refuse une tâche non queued', async () => {
    const run = store.createRun({ /* ... */ status: 'running', paused: true })
    const response = await POST(`/runs/${run.id}/start-queued`)
    expect(response.status).toBe(409)
  })
})
```

### Frontend
```typescript
describe('StartPausedButton', () => {
  it('affiche le bouton pour une tâche pausée', () => {
    const run = { id: '1', status: 'queued', paused: true }
    render(<TaskRow run={run} />)
    expect(screen.getByText('Start')).toBeInTheDocument()
  })

  it('n\'affiche pas le bouton pour une tâche non pausée', () => {
    const run = { id: '1', status: 'queued', paused: false }
    render(<TaskRow run={run} />)
    expect(screen.queryByText('Start')).not.toBeInTheDocument()
  })

  it('démarre la tâche au clic', async () => {
    const run = { id: '1', status: 'queued', paused: true }
    render(<TaskRow run={run} />)
    fireEvent.click(screen.getByText('Start'))
    await waitFor(() => {
      expect(startQueuedRun).toHaveBeenCalledWith('1')
    })
  })
})
```

## 📝 Notes importantes

1. **Persistance** : Le choix `queueOnly` est persisté dans le draft localStorage
2. **Compatibilité** : Aucun breaking change - tous les champs sont optionnels
3. **Restart** : Les tâches pausées survivent à un redémarrage (elles restent dans `pendingJobs`)
4. **Variants** : Compatible avec les variants (×2, ×3)
5. **Dispatch** : Compatible avec le mode dispatch
6. **Navigation** : En mode queue-only, l'utilisateur reste sur `/new` après création

## 🚀 Déploiement

### Étapes
1. Déployer le backend d'abord (contract + serveur + RunManager)
2. Déployer le frontend (UI peut utiliser les nouvelles routes)
3. Aucune migration de données nécessaire

### Rollback
Si nécessaire, les anciennes versions peuvent :
- Ignorer le champ `paused` (optionnel)
- Ignorer la route `/start-queued` (nouvelle)
- Les tâches pausées apparaîtront comme normalement `queued`

## 📊 Métriques suggérées

- Nombre de tâches créées en mode queue-only
- Temps moyen entre création et démarrage manuel
- Taux d'utilisation du bouton "Add to queue"
- Nombre de tâches pausées jamais démarrées (orphelines)

## 🎨 Améliorations futures possibles

1. **Filtre** : Ajouter un filtre "Paused" dans la liste des tâches
2. **Badge** : Afficher le nombre de tâches pausées dans la sidebar
3. **Bulk actions** : Démarrer plusieurs tâches pausées en une fois
4. **Auto-start** : Planifier le démarrage automatique à une heure précise
5. **Notification** : Alerter l'utilisateur des tâches pausées depuis X jours
