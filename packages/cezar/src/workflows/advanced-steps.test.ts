import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunStore } from '../runs/store.ts';
import { graphToSteps, type WorkflowGraph } from './graph.ts';
import { RunManager } from './run.ts';
import type { WorkflowDef } from './types.ts';

const run = promisify(execFile);
const GIT_ID = ['-c', 'user.name=test', '-c', 'user.email=test@local'];

/**
 * The advanced-step fields (spec 2026-10-07-workflow-enhancements): a step's `params`,
 * its `output:` capture, and its `if:` condition, exercised through a real RunManager.
 *
 * These fields existed on the schema and in `execution-context.ts` from the day they were
 * added, but the executor never called any of it after upstream replaced the linear step loop
 * with the graph walk — so the feature compiled, was unit-tested, and did nothing at run time.
 * Every case here fails against that state: the templating is only observable through a check
 * command's rendered argument, and a skipped step only through the run's own step statuses.
 */
describe('advanced workflow steps run through RunManager', () => {
  let repoRoot: string;
  let store: RunStore;
  let manager: RunManager;
  let savedDryRun: string | undefined;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cez-advanced-steps-'));
    savedDryRun = process.env.CEZ_DRY_RUN;
    process.env.CEZ_DRY_RUN = '1';
    await run('git', ['init', '-q', '-b', 'main'], { cwd: repoRoot });
    writeFileSync(join(repoRoot, 'a.txt'), 'one\n');
    await run('git', ['add', '-A'], { cwd: repoRoot });
    await run('git', [...GIT_ID, 'commit', '-q', '-m', 'base'], { cwd: repoRoot });
    store = RunStore.open(join(repoRoot, '.ai/cezar'));
    manager = new RunManager(store, repoRoot);
  });

  afterEach(() => {
    manager.dispose();
    if (savedDryRun === undefined) delete process.env.CEZ_DRY_RUN;
    else process.env.CEZ_DRY_RUN = savedDryRun;
    store.flush();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  async function settle(id: string) {
    const terminal = new Set(['done', 'review', 'failed', 'cancelled']);
    const deadline = Date.now() + 20_000;
    while (!terminal.has(store.getRun(id)?.status ?? '')) {
      if (Date.now() > deadline) throw new Error('run did not finish in time');
      await new Promise((r) => setTimeout(r, 100));
    }
    return store.getRun(id)!;
  }

  const v1 = (steps: WorkflowDef['steps']): WorkflowDef => ({ name: 'advanced', source: 'file', steps });

  it('renders {{params.*}} into a check command', async () => {
    const record = manager.startRun(
      v1([{ id: 'emit', command: 'echo "level={{params.level}}" > probe.txt', params: { level: 'high' } }]),
      { task: 'do the thing', worktree: false },
    );
    const final = await settle(record.id);

    expect(final.status).not.toBe('failed');
    expect(readFileSync(join(repoRoot, 'probe.txt'), 'utf8')).toBe('level=high\n');
  });

  it('captures a check’s stdout as `output:` and feeds it to a later step as {{outputs.*}}', async () => {
    const record = manager.startRun(
      v1([
        { id: 'emit', command: 'echo "diagnosis: missing config"', output: 'diag' },
        { id: 'consume', command: 'echo "got {{outputs.diag}}" > consume.txt' },
      ]),
      { task: 'do the thing', worktree: false },
    );
    const final = await settle(record.id);

    expect(final.status).not.toBe('failed');
    expect(readFileSync(join(repoRoot, 'consume.txt'), 'utf8')).toBe('got diagnosis: missing config\n');
  });

  it('leaves an unresolved {{outputs.*}} as written rather than blanking it', async () => {
    const record = manager.startRun(
      v1([{ id: 'consume', command: 'echo "got {{outputs.never_captured}}" > consume.txt' }]),
      { task: 'do the thing', worktree: false },
    );
    await settle(record.id);

    expect(readFileSync(join(repoRoot, 'consume.txt'), 'utf8')).toBe('got {{outputs.never_captured}}\n');
  });

  it('skips a step whose `if: previous.failed` does not hold, and keeps walking', async () => {
    const record = manager.startRun(
      v1([
        { id: 'probe', command: 'echo probe-ok' },
        { id: 'rescue', command: 'echo RAN >> ran.txt', if: 'previous.failed' },
        { id: 'finish', command: 'echo finish >> ran.txt' },
      ]),
      { task: 'do the thing', worktree: false },
    );
    const final = await settle(record.id);

    expect(final.status).not.toBe('failed');
    expect(final.steps.find((s) => s.id === 'rescue')?.status).toBe('skipped');
    expect(final.steps.find((s) => s.id === 'finish')?.status).toBe('done');
    // Only the step that was NOT skipped left a mark.
    expect(readFileSync(join(repoRoot, 'ran.txt'), 'utf8')).toBe('finish\n');
  });

  it('runs a step whose condition DOES hold', async () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'probe', type: 'check', command: 'exit 1' },
        { id: 'rescue', type: 'check', command: 'echo RAN >> ran.txt', if: 'step.probe.failed' },
        { id: 'ok', type: 'end', status: 'success' },
      ],
      edges: [
        { from: 'start', to: 'probe' },
        { from: 'probe.fail', to: 'rescue' },
        { from: 'rescue.pass', to: 'ok' },
      ],
    };
    const record = manager.startRun(
      { name: 'advanced', source: 'file', steps: graphToSteps(graph), graph },
      { task: 'do the thing', worktree: false },
    );
    const final = await settle(record.id);

    expect(final.status).not.toBe('failed');
    expect(final.steps.find((s) => s.id === 'rescue')?.status).toBe('done');
    expect(readFileSync(join(repoRoot, 'ran.txt'), 'utf8')).toBe('RAN\n');
  });

  it('skips a step whose condition does not hold and leaves by its success port', async () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'probe', type: 'check', command: 'exit 0' },
        { id: 'rescue', type: 'check', command: 'echo RAN >> ran.txt', if: 'step.probe.failed' },
        { id: 'ok', type: 'end', status: 'success' },
      ],
      edges: [
        { from: 'start', to: 'probe' },
        { from: 'probe.pass', to: 'rescue' },
        { from: 'rescue.pass', to: 'ok' },
      ],
    };
    const record = manager.startRun(
      { name: 'advanced', source: 'file', steps: graphToSteps(graph), graph },
      { task: 'do the thing', worktree: false },
    );
    const final = await settle(record.id);

    expect(final.status).not.toBe('failed');
    expect(final.steps.find((s) => s.id === 'rescue')?.status).toBe('skipped');
    expect(existsSync(join(repoRoot, 'ran.txt'))).toBe(false);
  });
});
