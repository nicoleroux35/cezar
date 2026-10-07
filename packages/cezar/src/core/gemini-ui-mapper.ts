/**
 * Gemini-specific ACP dialect and UI mapper state factory.
 *
 * Gemini CLI (`@google/gemini-cli` 0.60.0) over Agent Client Protocol:
 * - Replays full session history on `session/load` with `available_commands_update` marker
 * - Reports token usage in prompt results
 * - Uses standard ACP tool names and statuses
 * - Authentication via Google account or API key
 */

import type { AcpDialect, AcpUiMapperState } from './acp-ui-mapper.ts';
import type { TokenUsage, ToolKind } from './ui-events.ts';

export const GEMINI_AUTH_FAILURE_MESSAGE = 
  'Authentication required — run `gemini` to authenticate with your Google account or set GEMINI_API_KEY';

/**
 * The Gemini ACP dialect: tool names, usage extraction, and auth error recognition.
 */
export const geminiDialect: AcpDialect = {
  backend: 'gemini' as any,

  /**
   * Extract tool name from ACP tool_call update.
   * Gemini uses the standard ACP `title` field as the tool name.
   */
  toolNameOf(update: Record<string, unknown>): string {
    return String(update.title ?? 'unknown');
  },

  /**
   * Map special tool kinds. Gemini uses standard ACP kinds.
   */
  toolKindOf(name: string, update: Record<string, unknown>): ToolKind | undefined {
    // Gemini subagent delegation would be mapped here if supported
    return undefined;
  },

  /**
   * Extract token usage from session/prompt result.
   * Gemini reports usage in the prompt response.
   */
  usageFromPromptResult(result: Record<string, unknown>): TokenUsage | undefined {
    const usage = result.usage as Record<string, unknown> | undefined;
    if (!usage) return undefined;

    const input = Number(usage.inputTokens ?? 0);
    const output = Number(usage.outputTokens ?? 0);

    if (input === 0 && output === 0) return undefined;

    return { input, output, total: input + output };
  },

  /**
   * Translate JSON-RPC errors to user-facing messages.
   * Gemini-specific error codes and authentication failures.
   */
  errorMessage(error: Record<string, unknown>): string | undefined {
    const message = String(error.message ?? '');
    const code = Number(error.code ?? 0);

    // Authentication errors
    if (message.toLowerCase().includes('authentication') || 
        message.toLowerCase().includes('unauthorized') ||
        message.toLowerCase().includes('api key')) {
      return GEMINI_AUTH_FAILURE_MESSAGE;
    }

    // Session errors
    if (message.includes('session not found') || code === -32000) {
      return 'Session not found — the saved session may have expired';
    }

    // Rate limit errors
    if (message.includes('rate limit') || message.includes('quota')) {
      return 'Rate limit exceeded — please try again later';
    }

    return undefined;
  },
};

/**
 * Create initial ACP UI mapper state for a Gemini session.
 */
export function createGeminiUiState(): AcpUiMapperState {
  return {
    requests: new Map(),
    sessionId: null,
    turnSeq: 0,
    turnId: null,
    replaying: false,
    itemSeq: 0,
    openText: null,
    tools: new Map(),
    sessionUsage: null,
  };
}

/**
 * Check if stderr indicates a Gemini authentication failure.
 */
export function isGeminiAuthFailure(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return (
    lower.includes('authentication') ||
    lower.includes('unauthorized') ||
    lower.includes('api key') ||
    lower.includes('login required') ||
    lower.includes('not authenticated')
  );
}
