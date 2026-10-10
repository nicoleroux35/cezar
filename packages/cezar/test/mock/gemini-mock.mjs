#!/usr/bin/env node
/**
 * An offline stand-in for `gemini --acp`, so `CEZ_DRY_RUN=1` never reaches Google — the same role
 * `mock-copilot-acp.mjs` and `mock-junie-acp.mjs` play for their ACP runners.
 *
 * It speaks the frames the real CLI speaks: ACP `session/update` notifications carry their payload
 * under `params.update.sessionUpdate` (NOT a bare `params.type`), which is what
 * `src/core/acp-ui-mapper.ts` reads. The previous version emitted a made-up shape
 * (`params.type: 'message_delta'`), so the mapper rendered nothing and every gemini run came back
 * empty.
 *
 * Deliberately small: enough to prove the transport, the session lifecycle, follow-ups and resume
 * end to end. It is not a Gemini simulator, and it stays ALIVE after a turn — an ACP session is
 * long-lived, so it only exits on stdin close or SIGTERM.
 */
import readline from 'node:readline';

const SESSION_ID = '00000000-0000-4000-8000-00000gem1n1';
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const answer = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const update = (sessionId, body) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: body } });

let turn = 0;
let cancelled = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Handling a frame must never block the read loop: a prompt that awaited anything off stdin would
 *  deadlock the mock, so frames are dispatched without awaiting. */
async function handle(frame) {
  const { id, method, params } = frame;

  if (method === 'initialize') {
    answer(id, {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, audio: false, embeddedContext: true },
      },
      agentInfo: { name: 'Gemini', version: 'mock (CEZ_DRY_RUN=1)' },
    });
    return;
  }

  if (method === 'session/new') {
    answer(id, { sessionId: SESSION_ID });
    return;
  }

  if (method === 'session/load') {
    answer(id, {});
    // The real CLI ends a replay with this marker; the runner waits for it before prompting.
    update(params?.sessionId ?? SESSION_ID, { sessionUpdate: 'available_commands_update', availableCommands: [] });
    return;
  }

  if (method === 'session/set_model' || method === 'session/set_mode') {
    answer(id, {});
    return;
  }

  if (method === 'session/cancel') {
    cancelled = true;
    return; // a notification: no answer, the pending prompt resolves `cancelled`
  }

  if (method === 'session/prompt') {
    turn += 1;
    cancelled = false;
    const sessionId = params?.sessionId ?? SESSION_ID;
    const text = (params?.prompt ?? [])
      .filter((block) => block?.type === 'text')
      .map((block) => block.text)
      .join('\n');

    update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Reading the request.' } });
    update(sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId: `call_mock_${turn}`,
      title: '$ echo dry-run',
      kind: 'execute',
      status: 'pending',
      rawInput: { command: 'echo dry-run' },
      content: [],
    });

    // A beat, so a cancel arriving mid-turn is actually mid-turn.
    await sleep(20);
    if (cancelled) {
      answer(id, { stopReason: 'cancelled', usage: { inputTokens: 8, outputTokens: 0, totalTokens: 8 } });
      return;
    }

    update(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId: `call_mock_${turn}`,
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'dry-run' } }],
      rawOutput: { content: 'dry-run' },
    });
    update(sessionId, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: `[CEZ_DRY_RUN] Gemini mock answering turn ${turn}: ${text.slice(0, 120)}` },
    });
    answer(id, {
      stopReason: 'end_turn',
      usage: { inputTokens: 100 * turn, outputTokens: 20, totalTokens: 100 * turn + 20 },
    });
    return;
  }

  if (id !== undefined && method) fail(id, -32601, `Method not found: ${method}`);
}

for await (const line of readline.createInterface({ input: process.stdin })) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  let frame;
  try {
    frame = JSON.parse(trimmed);
  } catch {
    continue; // the real agent skips a line it cannot parse; so does this
  }
  void handle(frame);
}
