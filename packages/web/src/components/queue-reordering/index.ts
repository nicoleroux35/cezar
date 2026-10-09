// @ts-nocheck - TODO: Fix schema incompatibilities
/**
 * Queue reordering components - export all variants for easy import.
 * 
 * @example
 * ```tsx
 * // Import the advanced version with drag & drop
 * import { QueueManagerAdvanced } from '@/components/queue-reordering'
 * 
 * // Or the compact widget
 * import { QueueWidget } from '@/components/queue-reordering'
 * ```
 */

// Full-featured panels
export { QueueManager } from './queue-manager'
export { QueueManagerDnd } from './queue-manager-dnd'
export { QueueManagerAdvanced } from './queue-manager-advanced'

// Compact widget
export { QueueWidget } from './queue-widget'

// Building blocks
export { QueueReorderButtons } from './queue-reorder-buttons'
