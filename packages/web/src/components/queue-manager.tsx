import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon } from 'lucide-react'
import { reorderQueue } from '@/api/client'
import { queryKeys, useRuns } from '@/api/queries'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { runTitle } from '@/lib/task-groups'
import type { RunRecord } from '@open-mercato/maestro-api-client'

/**
 * Queue management panel - shows all queued tasks in order with reorder controls.
 * Can be rendered as a standalone panel or integrated into the tasks view.
 */
export function QueueManager() {
  const { data: runs } = useRuns()
  const queryClient = useQueryClient()

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

  const moveTask = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= queued.length) return
    const reordered = [...queued]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    reorderMutation.mutate(reordered.map((r) => r.id))
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Queue Order</h3>
        <p className="text-xs text-muted-foreground">
          {queued.length} task{queued.length !== 1 ? 's' : ''} waiting
        </p>
      </div>
      <TooltipProvider>
        <div className="divide-y divide-border">
          {queued.map((task, index) => (
            <div
              key={task.id}
              className="flex items-center gap-2 px-4 py-2.5 hover:bg-muted/50"
            >
              <GripVerticalIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground">
                {index + 1}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{runTitle(task)}</p>
              </div>
              <div className="flex items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => moveTask(index, index - 1)}
                      disabled={index === 0 || reorderMutation.isPending}
                      aria-label="Move up"
                    >
                      <ArrowUpIcon className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Move up in queue</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => moveTask(index, index + 1)}
                      disabled={index === queued.length - 1 || reorderMutation.isPending}
                      aria-label="Move down"
                    >
                      <ArrowDownIcon className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Move down in queue</TooltipContent>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      </TooltipProvider>
    </div>
  )
}
