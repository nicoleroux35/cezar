import { ChevronRightIcon, FolderIcon, PlayIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n/use-translations'
import { BUCKET_TRANSLATION_KEYS, type BucketLabel } from '@/lib/task-groups'
import { Button } from './ui/button'

/**
 * Task group header: collapsible section header for grouped tasks.
 *
 * Shows the group name, task count, and a "Start all" button when there are
 * queued tasks in the group.
 */
export function TaskGroupHeader({
  name,
  count,
  queuedCount,
  expanded,
  onToggle,
  onStartAll,
}: {
  name: string
  count: number
  queuedCount: number
  expanded: boolean
  onToggle: () => void
  onStartAll?: () => void
}) {
  const { t } = useTranslations()

  // Translate bucket name if it's a known bucket label
  const translatedName = (name in BUCKET_TRANSLATION_KEYS)
    ? t(BUCKET_TRANSLATION_KEYS[name as BucketLabel])
    : name

  const taskLabel = count === 1 ? t('tasks.group.task') : t('tasks.group.tasks')
  const expandLabel = expanded ? t('tasks.group.collapse') : t('tasks.group.expand')

  return (
    <div
      data-slot="task-group-header"
      className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5"
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex flex-1 items-center gap-2 text-left"
        aria-expanded={expanded}
        aria-label={`${expandLabel} ${translatedName}`}
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 text-soft-foreground transition-transform',
            expanded && 'rotate-90'
          )}
        />
        <FolderIcon aria-hidden="true" className="size-4 shrink-0 text-soft-foreground" />
        <span className="font-semibold text-sm text-foreground">{translatedName}</span>
        <span className="text-xs text-muted-foreground">
          ({count} {taskLabel})
        </span>
      </button>

      {queuedCount > 0 && onStartAll ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            onStartAll()
          }}
          className="h-7 gap-1.5 text-xs"
          title={`${t('tasks.group.startAll')} ${queuedCount} ${queuedCount === 1 ? t('tasks.group.task') : t('tasks.group.tasks')}`}
        >
          <PlayIcon className="size-3" aria-hidden="true" />
          {t('tasks.group.startAll')} ({queuedCount})
        </Button>
      ) : null}
    </div>
  )
}
