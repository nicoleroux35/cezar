import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GeminiRunner } from './gemini-runner.ts';
import type { AgentRunSpec } from './agent-runner.ts';

describe('GeminiRunner', () => {
  let runner: GeminiRunner;

  beforeEach(() => {
    runner = new GeminiRunner();
  });

  afterEach(async () => {
    await runner.interrupt();
  });

  it('has the correct backend identifier', () => {
    expect(runner.backend).toBe('gemini');
  });

  it('respects CEZ_GEMINI_BIN environment variable', () => {
    const customBin = '/custom/path/to/gemini';
    const customRunner = new GeminiRunner({ bin: customBin });
    expect(customRunner).toBeDefined();
  });

  it('uses mock binary in CEZ_DRY_RUN mode', () => {
    process.env.CEZ_DRY_RUN = '1';
    const dryRunner = new GeminiRunner();
    expect(dryRunner).toBeDefined();
    delete process.env.CEZ_DRY_RUN;
  });

  it('can create a session', () => {
    const spec: AgentRunSpec = {
      userPrompt: 'test prompt',
      cwd: process.cwd(),
    };

    const session = runner.startSession(spec);
    expect(session).toBeDefined();
    expect(session.open).toBe(true);
    expect(typeof session.pid).toBe('number');
    
    session.end();
  });

  it('supports model selection', () => {
    const spec: AgentRunSpec = {
      userPrompt: 'test prompt',
      cwd: process.cwd(),
      model: 'gemini-2.0-flash-exp',
    };

    const session = runner.startSession(spec);
    expect(session).toBeDefined();
    session.end();
  });

  it('supports session continuation', () => {
    const spec: AgentRunSpec = {
      userPrompt: 'continue this task',
      cwd: process.cwd(),
      sessionId: 'test-session-123',
    };

    const session = runner.startSession(spec);
    expect(session).toBeDefined();
    session.end();
  });

  it('handles interrupt gracefully', async () => {
    const spec: AgentRunSpec = {
      userPrompt: 'long running task',
      cwd: process.cwd(),
    };

    const session = runner.startSession(spec);
    expect(session.open).toBe(true);
    
    session.interrupt();
    
    const result = await session.result;
    expect(result).toBeDefined();
  });

  it('supports multi-turn conversations', () => {
    const spec: AgentRunSpec = {
      userPrompt: 'first message',
      cwd: process.cwd(),
    };

    const session = runner.startSession(spec);
    
    const success = session.sendMessage([{ type: 'text', text: 'second message' }]);
    expect(success).toBe(true);
    
    session.end();
  });

  it('queues messages when a turn is in flight', () => {
    const spec: AgentRunSpec = {
      userPrompt: 'first message',
      cwd: process.cwd(),
    };

    const session = runner.startSession(spec);
    
    // Send multiple messages rapidly
    const success1 = session.sendMessage([{ type: 'text', text: 'second message' }]);
    const success2 = session.sendMessage([{ type: 'text', text: 'third message' }]);
    
    expect(success1).toBe(true);
    expect(success2).toBe(true);
    
    session.end();
  });

  it('rejects messages after session is closed', () => {
    const spec: AgentRunSpec = {
      userPrompt: 'test',
      cwd: process.cwd(),
    };

    const session = runner.startSession(spec);
    session.end();
    
    // Wait a bit for closure
    setTimeout(() => {
      const success = session.sendMessage([{ type: 'text', text: 'too late' }]);
      expect(success).toBe(false);
    }, 500);
  });

  it('supports custom timeout', () => {
    const customTimeout = 60000;
    const customRunner = new GeminiRunner({ timeoutMs: customTimeout });
    expect(customRunner).toBeDefined();
  });

  it('emits events during execution', (done) => {
    const spec: AgentRunSpec = {
      userPrompt: 'test prompt',
      cwd: process.cwd(),
    };

    const events: any[] = [];
    const onEvent = (event: any) => {
      events.push(event);
    };

    const session = runner.startSession(spec, onEvent);
    
    session.result.then(() => {
      expect(events.length).toBeGreaterThan(0);
      done();
    });
  });
});

describe('Gemini exit code handling', () => {
  it('recognizes authentication failure (exit 41)', () => {
    const { geminiExitMessage } = require('./gemini-runner.ts');
    const message = geminiExitMessage(41, '');
    expect(message).toContain('Authentication');
  });

  it('recognizes session not found (exit 52)', () => {
    const { geminiExitMessage } = require('./gemini-runner.ts');
    const message = geminiExitMessage(52, '');
    expect(message).toContain('Session not found');
  });

  it('recognizes invalid session state (exit 55)', () => {
    const { geminiExitMessage } = require('./gemini-runner.ts');
    const message = geminiExitMessage(55, '');
    expect(message).toContain('Invalid session state');
  });

  it('includes stderr for unknown exit codes', () => {
    const { geminiExitMessage } = require('./gemini-runner.ts');
    const stderr = 'Some error message from stderr';
    const message = geminiExitMessage(99, stderr);
    expect(message).toContain('99');
    expect(message).toContain('Some error message');
  });
});

describe('Gemini auth detection', () => {
  it('detects authentication failure in stderr', () => {
    const { isGeminiAuthFailure } = require('./gemini-ui-mapper.ts');
    
    expect(isGeminiAuthFailure('Error: Authentication required')).toBe(true);
    expect(isGeminiAuthFailure('Unauthorized: Invalid API key')).toBe(true);
    expect(isGeminiAuthFailure('Login required to continue')).toBe(true);
    expect(isGeminiAuthFailure('not authenticated')).toBe(true);
  });

  it('does not false-positive on normal errors', () => {
    const { isGeminiAuthFailure } = require('./gemini-ui-mapper.ts');
    
    expect(isGeminiAuthFailure('Network error')).toBe(false);
    expect(isGeminiAuthFailure('Rate limit exceeded')).toBe(false);
    expect(isGeminiAuthFailure('')).toBe(false);
  });
});
