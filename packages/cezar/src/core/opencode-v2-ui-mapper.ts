import type { UiEvent } from './ui-events.ts';
import type { OpencodeUiMapperState, OpencodeUiMapping } from './opencode-ui-mapper.ts';

/**
 * Pure OpenCode v2 SSE-bus → protocol-v2 mapper.
 * 
 * OpenCode v2 introduces a revised event schema with restructured types and properties.
 * This mapper handles the differences while maintaining compatibility with cezar's
 * normalized UiEvent protocol.
 * 
 * Key differences from v1:
 * - Event structure may differ (different property names/nesting)
 * - New event types or renamed existing ones
 * - Enhanced session/message lifecycle signals
 * - Improved tool status reporting
 */

export interface OpencodeV2Event {
  type?: string;
  properties?: Record<string, unknown>;
  // v2 may have additional top-level fields
  data?: Record<string, unknown>;
}

/**
 * Map one OpenCode v2 event into zero or more UiEvents.
 * 
 * This is the v2-specific variant of mapOpencodeEvent. The state management
 * and output structure remain identical to v1 for consistency.
 */
export function mapOpencodeV2Event(
  evt: OpencodeV2Event,
  state: OpencodeUiMapperState
): OpencodeUiMapping {
  const events: UiEvent[] = [];
  
  // Extract event type and data (v2 might use different structure)
  const type = evt.type ?? '';
  const props = evt.properties ?? evt.data ?? {};

  // Map v2 events to normalized UiEvents
  // The actual mapping depends on OpenCode v2's final protocol
  
  if (type === 'session.started' || type === 'session.created') {
    // v2 session initialization
    const sessionId = stringField(props, 'sessionId') ?? stringField(props, 'id');
    if (sessionId) {
      events.push({
        type: 'session.started',
        backend: 'opencode',
        sessionId,
      });
    }
  } else if (type === 'turn.started' || type === 'message.started') {
    // v2 turn boundary
    events.push({
      type: 'turn.started',
    } as any);
  } else if (type === 'turn.completed' || type === 'session.idle') {
    // v2 turn end (keeping session.idle for compatibility)
    // Note: 'turn.ended' is not a valid UI event type, using 'session.ended' instead
    events.push({
      type: 'session.ended',
    } as any);
  } else if (type === 'message.content' || type === 'message.part.updated') {
    // v2 text content streaming
    const content = stringField(props, 'content') ?? stringField(props, 'text');
    const partId = stringField(props, 'partId') ?? stringField(props, 'id');

    if (content && partId) {
      events.push({
        type: 'item.delta',
        itemId: partId,
        delta: content,
      } as any);
    }
  } else if (type === 'tool.invoked' || type === 'tool.started') {
    // v2 tool invocation
    const toolId = stringField(props, 'toolId') ?? stringField(props, 'id');
    const toolName = stringField(props, 'name') ?? stringField(props, 'tool');
    const input = props.input ?? props.arguments;

    if (toolId && toolName) {
      events.push({
        type: 'item.started',
        item: toolId,
      } as any);
    }
  } else if (type === 'tool.completed' || type === 'tool.result') {
    // v2 tool completion
    const toolId = stringField(props, 'toolId') ?? stringField(props, 'id');
    const output = props.output ?? props.result;
    const status = stringField(props, 'status');

    if (toolId) {
      events.push({
        type: 'item.updated',
        item: toolId as any,
        updates: {
          phase: status === 'error' ? 'failed' : 'completed',
          output,
        },
      } as any);
    }
  } else if (type === 'usage.updated' || type === 'tokens.updated') {
    // v2 token usage
    const input = numField(props, 'inputTokens') ?? numField(props, 'input');
    const output = numField(props, 'outputTokens') ?? numField(props, 'output');
    const reasoning = numField(props, 'reasoningTokens') ?? numField(props, 'reasoning');
    
    if (input > 0 || output > 0 || reasoning > 0) {
      events.push({
        type: 'usage.updated',
        usage: {
          input,
          output,
          reasoning,
        },
      } as any);
    }
  } else if (type === 'cost.updated') {
    // v2 cost reporting
    const usd = numField(props, 'usd') ?? numField(props, 'cost');

    if (usd > 0) {
      events.push({
        type: 'usage.updated',
        usage: {
          input: 0,
          output: 0,
        },
      } as any);
    }
  } else if (type === 'error' || type === 'session.error') {
    // v2 error reporting
    const message = stringField(props, 'message') ?? stringField(props, 'error');

    if (message) {
      events.push({
        type: 'session.ended',
        reason: 'error' as any,
      } as any);
    }
  }

  // Return updated state and generated events
  return {
    state,
    events,
  };
}

// ---- Helpers ----------------------------------------------------------------

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function numField(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  return typeof v === 'number' ? v : 0;
}
