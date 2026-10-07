import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVerticalIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from '@/lib/project-router'
import { reorderQueue } from '@/api/client'
import { queryKeys, useRuns } from '@/api/queries'
import { toast } from '@/components/ui/toaster'
import { runTitle } from '@/lib/task-groups'
import { cn } from '@/lib/utils'
import type { RunRecord } from '@open-mercato/maestro-api-client'

interface SortableTaskItemProps {
  task: RunRecord
  index: number
  isDragging: boolean
}

function SortableTaskItem({ task, index, isDragging }: SortableTaskItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const title = runTitle(task)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 border-b border-border bg-card px-4 py-2.5 transition-colors last:border-b-0',
        isSortableDragging && 'z-50 opacity-50',
        !isDragging && 'hover:bg-muted/50',
      )}
    >
      <button
        type="button"
        className={cn(
          'cursor-grab touch-none text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing',
          isSortableDragging && 'cursor-grabbing',
        )}
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVerticalIcon className="size-4" aria-hidden="true" />
      </button>
      <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground">
        {index + 1}
      </div>
      <Link
        to={`/tasks/${task.id}`}
        className="min-w-0 flex-1 truncate text-sm text-foreground hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {title}
      </Link>
    </div>
  )
}

/**
 * Queue management panel with drag & drop reordering.
 * Shows all queued tasks in order and allows visual reordering by dragging.
 */
export function QueueManager() {
  const { data: runs } = useRuns()
  const queryClient = useQueryClient()
  const [isDragging, setIsDragging] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before dragging starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const reorderMutation = useMutation({
    mutationFn: reorderQueue,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.list() })
      toast.success('Queue reordered')
    },
    onError: (error: Error) => {
      toast.error(`Failed to reorder: ${error.message}`)
    },
  })

  if (!runs) return null

  const queued = runs
    .filter((r) => !r.archived && r.status === 'queued')
    .sort((a, b) => {
      const aTime = a.queuePosition ?? a.createdAt
      const bTime = b.queuePosition ?? b.createdAt
      return aTime.localeCompare(bTime)
    })

  if (queued.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">No queued tasks</p>
      </div>
    )
  }

  const handleDragStart = () => {
    setIsDragging(true)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setIsDragging(false)
    const { active, over } = event

    if (!over || active.id === over.id) return

    const oldIndex = queued.findIndex((task) => task.id === active.id)
    const newIndex = queued.findIndex((task) => task.id === over.id)

    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(queued, oldIndex, newIndex)
    reorderMutation.mutate(reordered.map((r) => r.id))
  }

  const handleDragCancel = () => {
    setIsDragging(false)
  }

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Queue Order</h3>
        <p className="text-xs text-muted-foreground">
          {queued.length} task{queued.length !== 1 ? 's' : ''} waiting · Drag to reorder
        </p>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={queued.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <div className="divide-y divide-border">
            {queued.map((task, index) => (
              <SortableTaskItem
                key={task.id}
                task={task}
                index={index}
                isDragging={isDragging}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
