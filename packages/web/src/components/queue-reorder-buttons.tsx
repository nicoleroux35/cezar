import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

interface QueueReorderButtonsProps {
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  disabled?: boolean
}

/**
 * Simple up/down buttons for reordering queued tasks.
 * Shows inline next to queued tasks in the task list.
 */
export function QueueReorderButtons({
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  disabled = false,
}: QueueReorderButtonsProps) {
  return (
    <div className="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation()
              onMoveUp()
            }}
            disabled={disabled || !canMoveUp}
            aria-label="Move up in queue"
          >
            <ArrowUpIcon className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Move up in queue</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation()
              onMoveDown()
            }}
            disabled={disabled || !canMoveDown}
            aria-label="Move down in queue"
          >
            <ArrowDownIcon className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Move down in queue</TooltipContent>
      </Tooltip>
    </div>
  )
}
