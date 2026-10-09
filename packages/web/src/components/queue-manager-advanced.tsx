// @ts-nocheck - TODO: Fix schema incompatibilities
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import { GripVerticalIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from '@/lib/project-router'
import { reorderQueue } from '@/api/client'
import { queryKeys, useRuns } from '@/api/queries'
import { toast } from '@/components/ui/toaster'
import { runTitle } from '@/lib/task-groups'
import { cn } from '@/lib/utils'
import type { RunRecord } from '@open-mercato/cezar-api-client'

interface TaskItemProps {
  task: RunRecord
  index: number
  isDragging?: boolean
  isOverlay?: boolean
}

function TaskItem({ task, index, isDragging = false, isOverlay = false }: TaskItemProps) {
  const title = runTitle(task)

  return (
    <div
      className={cn(
        'flex items-center gap-2 bg-card px-4 py-2.5',
        isOverlay && 'rounded-lg border border-border shadow-lg',
        !isOverlay && 'border-b border-border last:border-b-0',
        isDragging && !isOverlay && 'opacity-40',
        !isDragging && !isOverlay && 'transition-colors hover:bg-muted/50',
      )}
    >
      <div
        className={cn(
          'text-muted-foreground transition-colors',
          !isOverlay && 'cursor-grab active:cursor-grabbing hover:text-foreground',
        )}
      >
        <GripVerticalIcon className="size-4" aria-hidden="true" />
      </div>
      <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground">
        {index + 1}
      </div>
      {isOverlay ? (
        <div className="min-w-0 flex-1 truncate text-sm text-foreground">{title}</div>
      ) : (
        <Link
          to={`/tasks/${task.id}`}
          className="min-w-0 flex-1 truncate text-sm text-foreground hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {title}
        </Link>
      )}
    </div>
  )
}

interface SortableTaskItemProps {
  task: RunRecord
  index: number
}

function SortableTaskItem({ task, index }: SortableTaskItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskItem task={task} index={index} isDragging={isDragging} />
    </div>
  )
}

/**
 * Advanced queue management panel with drag & drop reordering and visual feedback.
 * Features:
 * - Drag & drop with smooth animations
 * - Visual overlay showing the dragged item
 * - Restricted to vertical movement only
 * - Keyboard accessible (Arrow keys + Space/Enter)
 * - Touch-friendly with activation distance
 */
export function QueueManagerAdvanced() {
  const { data: runs } = useRuns()
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before dragging starts (prevents accidental drags)
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

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event

    if (!over || active.id === over.id) return

    const oldIndex = queued.findIndex((task) => task.id === active.id)
    const newIndex = queued.findIndex((task) => task.id === over.id)

    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(queued, oldIndex, newIndex)
    reorderMutation.mutate(reordered.map((r) => r.id))
  }

  const handleDragCancel = () => {
    setActiveId(null)
  }

  const activeTask = activeId ? queued.find((t) => t.id === activeId) : null
  const activeIndex = activeTask ? queued.indexOf(activeTask) : -1

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
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      >
        <SortableContext items={queued.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <div className="divide-y divide-border">
            {queued.map((task, index) => (
              <SortableTaskItem key={task.id} task={task} index={index} />
            ))}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeTask ? (
            <TaskItem task={activeTask} index={activeIndex} isOverlay />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
