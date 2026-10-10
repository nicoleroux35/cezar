#!/usr/bin/env node
/**
 * Mock Antigravity CLI for CEZ_DRY_RUN=1 testing.
 * Implements minimal --headless --json-output mode.
 */

import { createInterface } from 'node:readline';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

let conversationId = 'mock-agy-conv-' + Date.now();
let messageId = 'msg-1';
let toolId = 'tool-1';

function send(obj) {
  console.log(JSON.stringify(obj));
}

let promptReceived = false;

rl.on('line', (line) => {
  if (!promptReceived) {
    promptReceived = true;
    
    // Simulate Antigravity agent workflow
    
    // 1. Conversation started
    send({
      type: 'conversation.started',
      conversationId,
      timestamp: new Date().toISOString(),
    });

    // 2. Message started
    setTimeout(() => {
      send({
        type: 'message.started',
        messageId,
        conversationId,
      });
    }, 50);

    // 3. Thinking (text deltas)
    setTimeout(() => {
      send({
        type: 'message.delta',
        messageId,
        delta: { text: 'I understand. ' },
      });
    }, 100);

    setTimeout(() => {
      send({
        type: 'message.delta',
        messageId,
        delta: { text: 'Let me analyze your request.\n\n' },
      });
    }, 150);

    // 4. Tool use (simulate file operation)
    setTimeout(() => {
      send({
        type: 'tool.started',
        toolId,
        tool: {
          name: 'write_file',
          input: { path: 'example.txt', content: 'Mock content' },
        },
      });
    }, 200);

    setTimeout(() => {
      send({
        type: 'tool.completed',
        toolId,
        tool: {
          name: 'write_file',
          output: 'File written successfully',
        },
      });
    }, 300);

    // 5. More text
    setTimeout(() => {
      send({
        type: 'message.delta',
        messageId,
        delta: { text: 'Task completed successfully.\n' },
      });
    }, 350);

    // 6. Turn completed
    setTimeout(() => {
      send({
        type: 'turn.completed',
        conversationId,
        stopReason: 'end_turn',
        usage: {
          inputTokens: 150,
          outputTokens: 80,
        },
      });
    }, 400);

    // 7. Exit gracefully
    setTimeout(() => {
      process.exit(0);
    }, 500);
  }
});

rl.on('close', () => {
  process.exit(0);
});

// Handle termination signals
process.on('SIGTERM', () => {
  send({
    type: 'session.interrupted',
    conversationId,
    reason: 'user_interrupt',
  });
  process.exit(0);
});

process.on('SIGINT', () => {
  send({
    type: 'session.interrupted',
    conversationId,
    reason: 'user_interrupt',
  });
  process.exit(0);
});
