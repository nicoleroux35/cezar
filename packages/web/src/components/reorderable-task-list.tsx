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
import type { ReorderRow, TaskGroup } from '@/lib/task-groups'
import { cn } from '@/lib/utils'

/**
 * Reorderable task list with drag & drop support.
 * Allows mixing ungrouped tasks and task groups in any order, and unfolding a group to
 * reorder the tasks inside it.
 */

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

/** The task rows of each expanded group, in list order — a group renders THESE inside its card. */
function groupMembers(items: readonly ReorderRow[]): Map<string, Extract<ReorderRow, { type: 'task' }>[]> {
  const byGroup = new Map<string, Extract<ReorderRow, { type: 'task' }>[]>()
  for (const item of items) {
    if (item.type !== 'task' || item.groupName === undefined) continue
    const rows = byGroup.get(item.groupName)
    if (rows) rows.push(item)
    else byGroup.set(item.groupName, [item])
  }
  return byGroup
}

export function ReorderableTaskList({
  items,
  onReorder,
  renderTask,
  renderGroup,
}: {
  items: ReorderRow[]
  onReorder: (newOrder: ReorderRow[]) => void
  renderTask: (run: RunRecord) => React.ReactNode
  /** A group renders its own card; `renderMembers` drops the group's (sortable) rows into it. */
  renderGroup: (group: TaskGroup, renderMembers: () => React.ReactNode) => React.ReactNode
}) {
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const membersByGroup = React.useMemo(() => groupMembers(items), [items])

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
          {/* Top level = the ungrouped tasks and the groups. A task inside an expanded group is
              not a top-level row: its group renders it, so the order on screen and the order in
              the payload never disagree about nesting. */}
          {items
            .filter((item) => item.type !== 'task' || item.groupName === undefined)
            .map((item) => {
              if (item.type === 'task') {
                return (
                  <SortableItem key={item.id} id={item.id}>
                    {renderTask(item.run)}
                  </SortableItem>
                )
              }
              return (
                <SortableItem key={item.id} id={item.id}>
                  {renderGroup(item.group, () =>
                    (membersByGroup.get(item.group.name) ?? []).map((member) => (
                      <SortableItem key={member.id} id={member.id}>
                        {renderTask(member.run)}
                      </SortableItem>
                    ))
                  )}
                </SortableItem>
              )
            })}
        </div>
      </SortableContext>
    </DndContext>
  )
}
