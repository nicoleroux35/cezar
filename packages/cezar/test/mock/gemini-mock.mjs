#!/usr/bin/env node
/**
 * Mock Gemini CLI for CEZ_DRY_RUN=1 testing.
 * Implements minimal ACP protocol over stdin/stdout.
 */

import { createInterface } from 'node:readline';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

let sessionId = 'mock-gemini-session-' + Date.now();
let messageCount = 0;

function send(obj) {
  console.log(JSON.stringify(obj));
}

function handleRequest(req) {
  const { id, method, params } = req;

  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          serverInfo: { name: 'gemini-mock', version: '0.60.0' },
          capabilities: { session: true, images: true },
        },
      });
      break;

    case 'session/new':
      send({
        jsonrpc: '2.0',
        id,
        result: { sessionId },
      });
      break;

    case 'session/load':
      sessionId = params.sessionId;
      send({
        jsonrpc: '2.0',
        id,
        result: { sessionId },
      });
      // Send replay marker
      setTimeout(() => {
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: { type: 'available_commands_update', commands: [] },
        });
      }, 50);
      break;

    case 'session/prompt':
      messageCount++;
      const turnId = `turn-${messageCount}`;

      // Send turn started
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { type: 'turn_started', turnId },
      });

      // Send thinking
      setTimeout(() => {
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            type: 'message_delta',
            messageId: `msg-${messageCount}`,
            delta: { type: 'text', text: 'Mock Gemini response: task completed successfully.\n' },
          },
        });
      }, 100);

      // Send completion
      setTimeout(() => {
        send({
          jsonrpc: '2.0',
          id,
          result: {
            stopReason: 'end_turn',
            usage: { inputTokens: 100, outputTokens: 50 },
          },
        });
      }, 200);
      break;

    default:
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
  }
}

rl.on('line', (line) => {
  try {
    const req = JSON.parse(line);
    if (req.method) {
      handleRequest(req);
    }
  } catch (err) {
    // Ignore malformed JSON
  }
});

rl.on('close', () => {
  process.exit(0);
});

// Handle termination signals
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
