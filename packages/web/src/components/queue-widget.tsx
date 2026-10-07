import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  closestCenter,
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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { GripVerticalIcon, ListOrderedIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from '@/lib/project-router'
import { reorderQueue } from '@/api/client'
import { queryKeys, useRuns } from '@/api/queries'
import { toast } from '@/components/ui/toaster'
import { runTitle } from '@/lib/task-groups'
import { cn } from '@/lib/utils'
import type { RunRecord } from '@open-mercato/maestro-api-client'

interface CompactTaskItemProps {
  task: RunRecord
  index: number
  isDragging?: boolean
  isOverlay?: boolean
}

function CompactTaskItem({ task, index, isDragging = false, isOverlay = false }: CompactTaskItemProps) {
  const title = runTitle(task)

  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 px-2 py-1.5 text-xs',
        isOverlay && 'rounded-md border border-border bg-card shadow-lg',
        !isOverlay && 'hover:bg-muted/50',
        isDragging && !isOverlay && 'opacity-30',
      )}
    >
      <div
        className={cn(
          'shrink-0 text-muted-foreground/50 transition-opacity',
          !isOverlay && 'cursor-grab group-hover:opacity-100 active:cursor-grabbing',
        )}
      >
        <GripVerticalIcon className="size-3" aria-hidden="true" />
      </div>
      <div className="flex size-4 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-medium text-muted-foreground">
        {index + 1}
      </div>
      {isOverlay ? (
        <div className="min-w-0 flex-1 truncate font-medium">{title}</div>
      ) : (
        <Link
          to={`/tasks/${task.id}`}
          className="min-w-0 flex-1 truncate font-medium hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {title}
        </Link>
      )}
    </div>
  )
}

interface SortableCompactItemProps {
  task: RunRecord
  index: number
}

function SortableCompactItem({ task, index }: SortableCompactItemProps) {
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
      <CompactTaskItem task={task} index={index} isDragging={isDragging} />
    </div>
  )
}

/**
 * Compact queue widget with drag & drop - perfect for sidebars or dashboards.
 * Minimal design with hover-revealed drag handles.
 */
export function QueueWidget() {
  const { data: runs } = useRuns()
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  )

  const reorderMutation = useMutation({
    mutationFn: reorderQueue,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.list() })
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
      <div className="rounded-lg border border-border bg-card px-3 py-2 text-center">
        <p className="text-xs text-muted-foreground">No queued tasks</p>
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
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <ListOrderedIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <h4 className="text-xs font-semibold">Queue</h4>
        <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {queued.length}
        </span>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        modifiers={[restrictToVerticalAxis]}
      >
        <SortableContext items={queued.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <div className="max-h-60 divide-y divide-border overflow-y-auto">
            {queued.map((task, index) => (
              <SortableCompactItem key={task.id} task={task} index={index} />
            ))}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeTask ? (
            <CompactTaskItem task={activeTask} index={activeIndex} isOverlay />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
