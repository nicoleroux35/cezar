import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunStore } from '../runs/store.js';
import type { RunManager } from '../workflows/run.js';
import { createApp } from './server.js';
import { apiRequest } from './loopback-request.testkit.js';

/**
 * `DELETE /api/v1/runs/:id` stops what the engine still owns before removing anything: an
 * active/queued/starting run is cancelled and the delete waits for the engine to release it
 * (`whenReleased`) — a record must never vanish under an unwinding session, whose terminal
 * writes would then throw (`appendEvent` refuses a forgotten run). The manager is a stub, so
 * these pin the ROUTE's contract: cancel first, delete only after release, and a teardown that
 * outlives the bound answers 409 with the record kept.
 */
describe('DELETE /runs/:id — stop-first', () => {
  let repoRoot: string;
  let store: RunStore;
  let app: Hono;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cez-del-'));
    store = RunStore.open(join(repoRoot, '.ai/cezar'));
  });

  afterEach(() => {
    store.flush();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function harness(manager: RunManager): void {
    app = createApp({ repoRoot, store, manager, version: '0.0.0-test' });
  }

  function createRun(): string {
    return store.createRun({ title: 't', workflow: 'quick-task', task: 't', steps: [] }).id;
  }

  /** A manager stub with controllable engine ownership. `release: false` = a teardown that
   *  outlives the bound — the honest "still stopping" the route must answer instead of deleting. */
  function stubManager(opts: { active?: boolean; release?: boolean } = {}): RunManager & {
    cancelCalls: string[];
  } {
    const cancelCalls: string[] = [];
    const manager = {
      cancelCalls,
      isActive: (id: string) => opts.active ?? false,
      cancel: (id: string) => {
        cancelCalls.push(id);
        return true;
      },
      whenReleased: async () => opts.release ?? true,
      sweepPrHeadRefs: async () => {},
    };
    return manager as unknown as RunManager & { cancelCalls: string[] };
  }

  it('deletes a terminal run without touching the manager', async () => {
    const manager = stubManager({ active: false });
    harness(manager);
    const id = createRun();

    const res = await apiRequest(app, `/api/v1/runs/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(store.getRun(id)).toBeUndefined();
    expect(manager.cancelCalls).toEqual([]);
  });

  it('cancels an active run and deletes it once the engine releases it', async () => {
    const manager = stubManager({ active: true, release: true });
    harness(manager);
    const id = createRun();

    const res = await apiRequest(app, `/api/v1/runs/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(manager.cancelCalls).toEqual([id]);
    expect(store.getRun(id)).toBeUndefined();
  });

  it('keeps the record and answers 409 when the engine is still stopping the run', async () => {
    const manager = stubManager({ active: true, release: false });
    harness(manager);
    const id = createRun();

    const res = await apiRequest(app, `/api/v1/runs/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/still stopping/);
    expect(manager.cancelCalls).toEqual([id]);
    // The record survives — the caller may retry once the teardown settles.
    expect(store.getRun(id)?.status).toBe('queued');
  });

  it('404s an unknown id', async () => {
    harness(stubManager());
    const res = await apiRequest(app, '/api/v1/runs/nope', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
