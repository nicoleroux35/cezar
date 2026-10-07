import { QueueManagerAdvanced } from '@/components/queue-manager-advanced'
import { QueueWidget } from '@/components/queue-widget'
import { useRuns } from '@/api/queries'

/**
 * Example page demonstrating queue management components.
 * This can be added as a route in your application.
 */
export function QueueManagementPage() {
  const { data: runs } = useRuns()
  
  const queuedCount = runs?.filter(r => !r.archived && r.status === 'queued').length ?? 0

  return (
    <div className="flex min-h-full flex-col gap-6 p-6">
      {/* Page header */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Queue Management</h1>
        <p className="text-sm text-muted-foreground">
          Reorder tasks to prioritize what runs next. Drag and drop or use keyboard shortcuts.
        </p>
      </div>

      {/* Main content - responsive layout */}
      <div className="flex flex-1 gap-6">
        {/* Main panel - takes most space */}
        <div className="flex-1">
          {queuedCount === 0 ? (
            <div className="flex min-h-[400px] items-center justify-center rounded-lg border border-dashed border-border">
              <div className="text-center">
                <h3 className="text-lg font-semibold">No queued tasks</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Tasks will appear here when they're waiting to run
                </p>
              </div>
            </div>
          ) : (
            <QueueManagerAdvanced />
          )}
        </div>

        {/* Sidebar with compact widget - hidden on mobile */}
        <aside className="hidden w-80 space-y-4 lg:block">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Quick View</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Compact queue preview for quick reference
            </p>
            <QueueWidget />
          </div>
          
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Keyboard Shortcuts</h2>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Select task</dt>
                <dd className="font-mono">Tab</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Move up</dt>
                <dd className="font-mono">↑</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Move down</dt>
                <dd className="font-mono">↓</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Pick up/Drop</dt>
                <dd className="font-mono">Space</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>

      {/* Help text */}
      <div className="rounded-lg border border-border bg-muted/50 p-4">
        <h3 className="mb-2 text-sm font-semibold">How it works</h3>
        <ul className="space-y-1 text-sm text-muted-foreground">
          <li>• Tasks are processed in the order shown (top to bottom)</li>
          <li>• Drag and drop to reorder, or use the keyboard shortcuts</li>
          <li>• Changes are saved automatically and synchronized across tabs</li>
          <li>• The queue respects your configured parallel task limit</li>
        </ul>
      </div>
    </div>
  )
}
