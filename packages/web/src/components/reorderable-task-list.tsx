import React from 'react'
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
import type { RunRecord } from '@open-mercato/cezar-api-client'
import type { TaskGroup } from '@/lib/task-groups'
import { cn } from '@/lib/utils'

/**
 * Reorderable task list with drag & drop support.
 * Allows mixing ungrouped tasks and task groups in any order.
 */

type ReorderableItem =
  | { type: 'task'; id: string; run: RunRecord }
  | { type: 'group'; id: string; group: TaskGroup }

interface SortableItemProps {
  id: string
  children: React.ReactNode
}

function SortableItem({ id, children }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative',
        isDragging && 'z-50 opacity-50'
      )}
    >
      <div className="group relative">
        {/* Drag handle */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="absolute -left-6 top-1/2 -translate-y-1/2 cursor-grab p-1 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVerticalIcon className="size-4 text-muted-foreground" />
        </button>
        {children}
      </div>
    </div>
  )
}

export function ReorderableTaskList({
  items,
  onReorder,
  renderTask,
  renderGroup,
}: {
  items: ReorderableItem[]
  onReorder: (newOrder: ReorderableItem[]) => void
  renderTask: (run: RunRecord) => React.ReactNode
  renderGroup: (group: TaskGroup) => React.ReactNode
}) {
  const [activeId, setActiveId] = React.useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required to start drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)

    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item) => item.id === active.id)
      const newIndex = items.findIndex((item) => item.id === over.id)

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(items, oldIndex, newIndex)
        onReorder(newOrder)
      }
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event) => setActiveId(event.active.id as string)}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {items.map((item) => (
            <SortableItem key={item.id} id={item.id}>
              {item.type === 'task' ? renderTask(item.run) : renderGroup(item.group)}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
