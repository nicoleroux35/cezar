import { useMutation, useQueryClient } from '@tanstack/react-query'
import { reorderQueue } from '@/api/client'
import { queryKeys } from '@/api/queries'
import { toast } from '@/components/ui/toaster'
import type { RunRecord } from '@open-mercato/maestro-api-client'

/**
 * Hook for reordering queued tasks. Provides moveUp/moveDown helpers
 * that reorder a task relative to its neighbors in the queue.
 */
export function useQueueReorder() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: reorderQueue,
    onSuccess: (_, runIds) => {
      // Invalidate runs list to refetch with new queue positions
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.list() })
      toast.success(`Reordered ${runIds.length} task${runIds.length !== 1 ? 's' : ''}`)
    },
    onError: (error: Error) => {
      toast.error(`Failed to reorder queue: ${error.message}`)
    },
  })

  /**
   * Move a queued task up one position in the queue.
   * Returns false if the task is already first or not queued.
   */
  const moveUp = (runs: RunRecord[], taskId: string): boolean => {
    const queued = runs
      .filter((r) => !r.archived && r.status === 'queued')
      .sort((a, b) => {
        const aTime = a.queuePosition ?? a.createdAt
        const bTime = b.queuePosition ?? b.createdAt
        return aTime.localeCompare(bTime)
      })

    const index = queued.findIndex((r) => r.id === taskId)
    if (index <= 0) return false // Already first or not found

    // Swap with the one before it
    const reordered = [...queued]
    ;[reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]]

    mutation.mutate(reordered.map((r) => r.id))
    return true
  }

  /**
   * Move a queued task down one position in the queue.
   * Returns false if the task is already last or not queued.
   */
  const moveDown = (runs: RunRecord[], taskId: string): boolean => {
    const queued = runs
      .filter((r) => !r.archived && r.status === 'queued')
      .sort((a, b) => {
        const aTime = a.queuePosition ?? a.createdAt
        const bTime = b.queuePosition ?? b.createdAt
        return aTime.localeCompare(bTime)
      })

    const index = queued.findIndex((r) => r.id === taskId)
    if (index === -1 || index >= queued.length - 1) return false // Already last or not found

    // Swap with the one after it
    const reordered = [...queued]
    ;[reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]]

    mutation.mutate(reordered.map((r) => r.id))
    return true
  }

  return {
    moveUp,
    moveDown,
    isPending: mutation.isPending,
  }
}
