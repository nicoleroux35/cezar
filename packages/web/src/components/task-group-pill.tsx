import { FolderIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { PickerPill, chipClass, chevron } from './picker-pill'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from './ui/command'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { cn } from '@/lib/utils'

/**
 * Task group picker: select or create a group for organizing related tasks.
 *
 * Groups are user-defined names for organizing tasks. Tasks in the same group
 * can be displayed together and launched in parallel (respecting maxParallel).
 */
export function TaskGroupPill({
  taskGroupId,
  taskGroupName,
  existingGroups,
  onSelect,
}: {
  taskGroupId: string | null
  taskGroupName: string | null
  /** Existing group names from other tasks in this project */
  existingGroups: readonly string[]
  onSelect: (groupId: string | null, groupName: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  // Filter existing groups by search
  const filtered = existingGroups.filter((name) =>
    name.toLowerCase().includes(search.toLowerCase().trim())
  )

  // If search doesn't match any existing group, offer to create it
  const searchTrimmed = search.trim()
  const canCreate = searchTrimmed.length > 0 && !existingGroups.includes(searchTrimmed)

  const handleSelect = (name: string) => {
    // Generate a simple ID based on the name (or use UUID if preferred)
    const id = name.toLowerCase().replace(/\s+/g, '-')
    onSelect(id, name)
    setOpen(false)
    setSearch('')
  }

  const handleClear = () => {
    onSelect(null, null)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="task-group-pill"
          aria-label="Task group"
          title={
            taskGroupName
              ? `Group: ${taskGroupName} — click to change or clear`
              : 'Assign this task to a group — optional'
          }
          className={cn(
            chipClass,
            taskGroupName && 'border-primary/60 font-medium text-foreground'
          )}
        >
          <FolderIcon aria-hidden="true" className="size-3 shrink-0 text-soft-foreground" />
          <span className="max-w-32 truncate">
            {taskGroupName || 'No group'}
          </span>
          {taskGroupName ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleClear()
              }}
              className="ml-0.5 rounded-sm hover:bg-muted"
              aria-label="Clear group"
            >
              <XIcon aria-hidden="true" className="size-3" />
            </button>
          ) : (
            chevron
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-[280px] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search or create group…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList
            data-slot="task-group-menu"
            className="max-h-[min(18rem,calc(var(--radix-popover-content-available-height)-3rem))]"
          >
            {filtered.length === 0 && !canCreate ? (
              <CommandEmpty>
                {search.trim() ? 'No matching groups' : 'No groups yet — type to create one'}
              </CommandEmpty>
            ) : null}

            {canCreate ? (
              <CommandItem
                key="create"
                value={`create-${searchTrimmed}`}
                data-slot="create-group-option"
                onSelect={() => handleSelect(searchTrimmed)}
              >
                <span className="text-xs font-medium text-foreground">
                  Create "{searchTrimmed}"
                </span>
              </CommandItem>
            ) : null}

            {filtered.map((name) => (
              <CommandItem
                key={name}
                value={name}
                data-slot="group-option"
                onSelect={() => handleSelect(name)}
              >
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{name}</span>
              </CommandItem>
            ))}
          </CommandList>
          <p className="border-t border-border px-3 py-2 text-[11px] leading-snug text-soft-foreground">
            Tasks in the same group can be launched together in parallel.
          </p>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
