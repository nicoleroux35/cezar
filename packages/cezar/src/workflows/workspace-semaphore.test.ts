import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunStore } from '../runs/store.ts';
import { RegistryCache } from '../self-update/registry.ts';
import { SelfUpdateService } from '../self-update/service.ts';
import { WorkspaceSemaphore } from '../workspace/semaphore.ts';
import { RunManager } from './run.ts';
import type { WorkflowDef } from './types.ts';

const GIT_ID = ['-c', 'user.name=test', '-c', 'user.email=test@local'];

/**
 * The per-project parallel cap (spec 2026-07-20-multi-project-workspace,
 * step 2.5, per-project amendment): ONE `WorkspaceSemaphore` shared by every
 * project's RunManager, but each project is gated on its OWN cap — the
 * registry override when set, else the workspace `resources.maxParallel`
 * default — counted over the managers scoped to that project's root. Other
 * projects' activity never blocks a project, and a project's overflow never
 * borrows another project's slots. Three contracts, each against real
 * managers on real fixture repos (run.test.ts conventions — check-step slot
 * holders, and the CEZ_DRY_RUN mock agent where a live session is needed):
 *
 *  1. two managers, cap 2 → EACH project runs 2 concurrently (4 total); a
 *     third run in a project queues on THAT project's cap;
 *  2. a slot freed in a project starts the run queued in THAT project — the
 *     other project's saturation is irrelevant;
 *  3. the #347 exemption survives: a `waiting` run holds no slot, and a
 *     message into it resumes it immediately even at the project's own cap —
 *     the resume must never hang on the queue;
 *  4. `refresh()` (the cache hook boot and PUT /api/v1/workspace/config call)
 *     applies a config change without a restart: raising the cap starts a
 *     queued run right away.
 */

/** Real git fixture repo — worktree-isolated runs genuinely succeed. */
function fixtureRepo(prefix: string, roots: string[]): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', [...GIT_ID, 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: root });
  return root;
}

async function waitFor(predicate: () => boolean, what: string, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const settled = ['done', 'failed', 'cancelled', 'review'];

/** Holds a workspace slot (status `running`, never `waiting`) long enough to
 *  observe scheduling — a check step, so no agent process is involved. */
const SLOW: WorkflowDef = {
  name: 'slow',
  source: 'built-in',
  steps: [{ id: 'hold', command: 'node -e "setTimeout(()=>{},3000)"' }],
};
const INSTANT: WorkflowDef = {
  name: 'instant',
  source: 'built-in',
  steps: [{ id: 'noop', command: 'node -e ""' }],
};
/** One interactive agent step — the mock parks at `waiting` after its turn. */
const AGENT: WorkflowDef = {
  name: 'quick-task',
  source: 'built-in',
  steps: [{ id: 'task', name: 'Task', prompt: '{{task}}' }],
};

describe('workspace semaphore across RunManagers (step 2.5)', () => {
  const roots: string[] = [];
  const managers: RunManager[] = [];
  const stores: RunStore[] = [];
  const savedEnv: Record<string, string | undefined> = {};

  /** A project: fixture repo + store + manager on the SHARED semaphore. */
  function project(
    prefix: string,
    semaphore: WorkspaceSemaphore,
  ): { store: RunStore; manager: RunManager; root: string } {
    const root = fixtureRepo(prefix, roots);
    const store = RunStore.open(join(root, '.ai/cezar'));
    const manager = new RunManager(store, root, { semaphore });
    stores.push(store);
    managers.push(manager);
    return { store, manager, root };
  }

  beforeEach(() => {
    savedEnv.CEZ_DRY_RUN = process.env.CEZ_DRY_RUN;
    process.env.CEZ_DRY_RUN = '1';
  });

  it('exempts only the configured number of durable monitoring sessions', () => {
    const semaphore = new WorkspaceSemaphore({ initial: { maxParallel: 2, maxMonitoringSessions: 2 } });
    const projectA = project('cez-monitor-cap-', semaphore);
    const internals = projectA.manager as unknown as {
      active: Map<string, object>;
      waiting: Set<string>;
      monitoring: Set<string>;
      busySlots(): number;
    };
    for (const id of ['ordinary', 'm1', 'm2', 'm3']) internals.active.set(id, {});
    for (const id of ['ordinary', 'm1', 'm2', 'm3']) internals.waiting.add(id);
    for (const id of ['m1', 'm2', 'm3']) internals.monitoring.add(id);
    // ordinary wait is exempt; two monitors are exempt; monitor #3 back-pressures the active pool.
    expect(internals.busySlots()).toBe(1);
    expect(semaphore.busy()).toBe(1);
  });

  afterEach(async () => {
    // Settle everything before tearing the fixtures down: cancel whatever is
    // still live and wait for terminal statuses, so no check-step child or
    // mock session outlives its repo directory.
    for (const store of stores) {
      for (const run of store.listRuns()) {
        const m = managers[stores.indexOf(store)];
        if (!settled.includes(store.getRun(run.id)?.status ?? '')) m?.cancel(run.id);
      }
    }
    for (const store of stores) {
      await waitFor(
        () => store.listRuns().every((r) => settled.includes(r.status)),
        'all runs to settle before teardown',
      ).catch(() => undefined);
      store.flush();
    }
    for (const manager of managers.splice(0)) manager.dispose();
    stores.length = 0;
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    if (savedEnv.CEZ_DRY_RUN === undefined) delete process.env.CEZ_DRY_RUN;
    else process.env.CEZ_DRY_RUN = savedEnv.CEZ_DRY_RUN;
  });

  it('caps runs per project: with cap 2, A runs 2 AND B runs 2 concurrently; a third run in A queues', async () => {
    // The per-project amendment: the workspace `resources.maxParallel` is each
    // project's OWN allowance, not a shared pool. Four holders across two
    // projects must all run — under the old workspace-wide gate the third and
    // fourth would have queued.
    const semaphore = new WorkspaceSemaphore({ initial: { maxParallel: 2 } });
    const a = project('cez-wsem-a-', semaphore);
    const b = project('cez-wsem-b-', semaphore);

    const slowA1 = a.manager.startRun(SLOW, { task: 'hold a slot (A1)' });
    const slowA2 = a.manager.startRun(SLOW, { task: 'hold a slot (A2)' });
    const slowB1 = b.manager.startRun(SLOW, { task: 'hold a slot (B1)' });
    const slowB2 = b.manager.startRun(SLOW, { task: 'hold a slot (B2)' });
    await waitFor(
      () =>
        a.store.getRun(slowA1.id)?.status === 'running' &&
        a.store.getRun(slowA2.id)?.status === 'running' &&
        b.store.getRun(slowB1.id)?.status === 'running' &&
        b.store.getRun(slowB2.id)?.status === 'running',
      'both projects to hold two slots each',
    );

    // Third run in A — A is at its own cap of 2, so it must queue even though
    // no workspace-wide ceiling exists any more.
    const third = a.manager.startRun(INSTANT, { task: 'third in A — must queue' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(a.store.getRun(third.id)?.status).toBe('queued');

    // Capacity returns as A's holders settle — the queued run then completes.
    await waitFor(
      () => settled.includes(a.store.getRun(third.id)?.status ?? ''),
      'the queued run to complete once A frees a slot',
      30_000,
    );
    expect(a.store.getRun(third.id)?.status).toBe('done');
  }, 45_000);

  // #1524: the self-update dialog read the boot project's store only, so tasks in any other
  // project — or every task, when cezar booted outside a project — counted as zero.
  it('the self-update status counts running and queued runs in every project', async () => {
    const semaphore = new WorkspaceSemaphore({ initial: { maxParallel: 1 } });
    const a = project('cez-wsem-upd-a-', semaphore);
    const b = project('cez-wsem-upd-b-', semaphore);
    const offline = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    const selfUpdate = new SelfUpdateService({
      pkgName: 'x',
      version: '0.0.0',
      entry: 'index.js',
      restart: () => {},
      runs: semaphore,
      registry: new RegistryCache('x', offline),
    });
    expect((await selfUpdate.status()).activeRuns).toBe(0);

    const slowA = a.manager.startRun(SLOW, { task: 'running in A' });
    await waitFor(() => a.store.getRun(slowA.id)?.status === 'running', 'the A run to start');
    // Per-project cap: B has its own slot even while A holds its one, so B runs too.
    const runB = b.manager.startRun(SLOW, { task: 'running in B' });
    await waitFor(() => b.store.getRun(runB.id)?.status === 'running', 'the B run to start');

    expect((await selfUpdate.status()).activeRuns).toBe(2);
    expect(semaphore.idle()).toBe(false);
  });

  it("a slot freed in a project starts THAT project's queued run while the other project stays saturated", async () => {
    // A saturates its own cap and B saturates its own cap plus queues a third.
    // B's queued run must start once B frees a slot — A's saturation is
    // irrelevant, and B's overflow never borrows A's slots.
    const semaphore = new WorkspaceSemaphore({ initial: { maxParallel: 2 } });
    const a = project('cez-wsem-cross-a-', semaphore);
    const b = project('cez-wsem-cross-b-', semaphore);

    const slowA1 = a.manager.startRun(SLOW, { task: 'A saturate 1' });
    const slowA2 = a.manager.startRun(SLOW, { task: 'A saturate 2' });
    const slowB1 = b.manager.startRun(SLOW, { task: 'B saturate 1' });
    const slowB2 = b.manager.startRun(SLOW, { task: 'B saturate 2' });
    await waitFor(
      () =>
        a.store.getRun(slowA1.id)?.status === 'running' &&
        a.store.getRun(slowA2.id)?.status === 'running' &&
        b.store.getRun(slowB1.id)?.status === 'running' &&
        b.store.getRun(slowB2.id)?.status === 'running',
      'both projects to saturate their own caps',
    );

    const queued = b.manager.startRun(INSTANT, { task: 'queued over B own cap' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(b.store.getRun(queued.id)?.status).toBe('queued');

    // The only event that matters is B's runs settling.
    await waitFor(
      () => settled.includes(b.store.getRun(queued.id)?.status ?? ''),
      "B's queued run to start once B frees a slot",
      30_000,
    );
    expect(b.store.getRun(queued.id)?.status).toBe('done');
  }, 45_000);

  it("queues are per project: B's run starts while A is saturated, and A's overflow waits for A's slot", async () => {
    // Cap 1 per project. A's holder saturates A — B's own cap is free, so B's
    // run must start at once (under the old workspace-wide gate it queued
    // behind A's holder). A's own overflow queues behind A's holder and takes
    // A's slot when it frees.
    const semaphore = new WorkspaceSemaphore({ initial: { maxParallel: 1 } });
    const a = project('cez-wsem-fair-a-', semaphore);
    const b = project('cez-wsem-fair-b-', semaphore);

    const holder = a.manager.startRun(SLOW, { task: 'hold the only slot' });
    await waitFor(() => a.store.getRun(holder.id)?.status === 'running', 'the holder to run');
    const other = b.manager.startRun(INSTANT, { task: 'other project, free cap' });
    await waitFor(
      () => settled.includes(b.store.getRun(other.id)?.status ?? ''),
      "B's run to finish despite A's saturation",
      30_000,
    );
    expect(b.store.getRun(other.id)?.status).toBe('done');

    // A's own overflow queues behind A's holder...
    const newer = a.manager.startRun(SLOW, { task: 'queued second, same project' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(a.store.getRun(newer.id)?.status).toBe('queued');

    // ...and takes A's slot when the holder settles.
    await waitFor(
      () => a.store.getRun(newer.id)?.status === 'running',
      "A's queued run to take the freed slot",
      30_000,
    );
  }, 45_000);

  it('#347 across projects: a waiting run resumes immediately even when other projects saturate the cap', async () => {
    const semaphore = new WorkspaceSemaphore({ initial: { maxParallel: 2 } });
    const a = project('cez-wsem-347a-', semaphore);
    const b = project('cez-wsem-347b-', semaphore);

    // B's agent run parks at `waiting` (markerless mock turn-end) — and by the
    // #347 rule gives its slot back while parked.
    const waitingRun = b.manager.startRun(AGENT, { task: 'park and wait', worktree: false });
    await waitFor(
      () => b.store.getRun(waitingRun.id)?.status === 'waiting',
      "B's run to park at waiting",
    );

    // Project A saturates its own cap: 2 running holders.
    const slow1 = a.manager.startRun(SLOW, { task: 'saturate 1' });
    const slow2 = a.manager.startRun(SLOW, { task: 'saturate 2' });
    await waitFor(
      () =>
        a.store.getRun(slow1.id)?.status === 'running' &&
        a.store.getRun(slow2.id)?.status === 'running',
      'A to saturate the cap',
    );

    // The #347 exemption: the message goes straight into the open session —
    // no slot acquire, no queue — even though that momentarily exceeds the
    // cap. Before #347 (and if a resume ever acquired a workspace slot) this
    // would hang until A's runs finished.
    expect(
      b.manager.sendMessage(waitingRun.id, [{ type: 'text', text: 'carry on please' }]),
    ).toBe(true);
    const resumed = b.store.getRun(waitingRun.id);
    expect(resumed?.status).toBe('running'); // resumed instantly, cap exceeded by design
    // ...while A's saturating runs are genuinely still holding both slots.
    expect(a.store.getRun(slow1.id)?.status).toBe('running');
    expect(a.store.getRun(slow2.id)?.status).toBe('running');

    // The resumed turn completes and re-parks — the exemption is a moment of
    // over-cap, not a leak.
    await waitFor(
      () => b.store.getRun(waitingRun.id)?.status === 'waiting',
      "B's run to re-park after the resumed turn",
    );
  }, 45_000);

  it('per-project cap: project A limited to 1 runs one at a time while B uses its own inherited cap', async () => {
    // Shared snapshot the load hook copies on each refresh — mutating the map
    // and calling refresh() mirrors a settings write to a project's maxParallel.
    const projectLimits = new Map<string, number>();
    const semaphore = new WorkspaceSemaphore({
      load: () =>
        Promise.resolve({ maxParallel: 4, memoryLimitMb: null, projectLimits: new Map(projectLimits) }),
      initial: { maxParallel: 4 },
    });
    const a = project('cez-wsem-ppA-', semaphore);
    const rootA = a.root;
    const b = project('cez-wsem-ppB-', semaphore);

    // Pin project A to a single concurrent run; refresh so the snapshot carries it.
    projectLimits.set(realpathSync(rootA), 1);
    await semaphore.refresh();

    // A starts two runs. The workspace default is 4, but A's own ceiling is
    // 1 — so the second A run must queue on the per-project gate.
    const a1 = a.manager.startRun(SLOW, { task: 'A slot 1' });
    const a2 = a.manager.startRun(SLOW, { task: 'A slot 2 — must queue on A per-project cap' });
    await waitFor(() => a.store.getRun(a1.id)?.status === 'running', 'A first run to run');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(a.store.getRun(a2.id)?.status).toBe('queued'); // blocked by A's own cap

    // B inherits the workspace default as its OWN cap (no override) — it runs two concurrently.
    const b1 = b.manager.startRun(SLOW, { task: 'B slot 1' });
    const b2 = b.manager.startRun(SLOW, { task: 'B slot 2' });
    await waitFor(
      () =>
        b.store.getRun(b1.id)?.status === 'running' && b.store.getRun(b2.id)?.status === 'running',
      'B to run two concurrently under its own cap',
    );

    // A still runs only one.
    expect(a.store.getRun(a1.id)?.status).toBe('running');
    expect(a.store.getRun(a2.id)?.status).toBe('queued');
    expect(semaphore.busy()).toBeLessThanOrEqual(4);

    // Once A's holder settles, A's second run starts — the cap gates, never strands.
    await waitFor(
      () => settled.includes(a.store.getRun(a2.id)?.status ?? ''),
      "A's queued run to start and finish after its slot frees",
      30_000,
    );
    expect(a.store.getRun(a2.id)?.status).toBe('done');
  }, 60_000);

  it('restart recovery queues interrupted continuations behind the per-project cap', async () => {
    const root = fixtureRepo('cez-wsem-recover-cap-', roots);
    const projectLimits = new Map([[realpathSync(root), 1]]);
    const semaphore = new WorkspaceSemaphore({
      load: () =>
        Promise.resolve({ maxParallel: 3, memoryLimitMb: null, projectLimits }),
      initial: { maxParallel: 3 },
    });
    await semaphore.refresh();
    const store = RunStore.open(join(root, '.ai/cezar'), { keepLive: true });
    const firstManager = new RunManager(store, root, { semaphore });
    stores.push(store);

    for (const suffix of ['one', 'two', 'three']) {
      const record = store.createRun({
        title: suffix,
        workflow: 'quick-task',
        task: `interrupted ${suffix}`,
        runner: 'claude',
        steps: [{ id: 'task', name: 'Task', kind: 'agent' }],
      });
      store.updateStep(record.id, 'task', {
        status: 'running',
        iterations: 1,
        sessionId: `session-${suffix}`,
        backend: 'claude',
      });
      store.updateRun(record.id, { status: 'running', currentStepId: 'task' });
    }

    // Hold the first admitted continuation open. This isolates scheduler
    // admission from backend timing and makes the cap observable.
    const never = new Promise<void>(() => undefined);
    const holdContinuation = (manager: RunManager) => {
      (
        manager as unknown as {
          runContinuation(runId: string, stepId: string): Promise<void>;
        }
      ).runContinuation = async (runId: string, stepId: string) => {
        store.updateStep(runId, stepId, { status: 'running' });
        store.updateRun(runId, { status: 'running', currentStepId: stepId });
        await never;
      };
    };
    holdContinuation(firstManager);

    await firstManager.recover();
    await waitFor(
      () => store.listRuns().filter((run) => run.status === 'running').length === 1,
      'one recovered continuation to take the project slot',
    );
    expect(store.listRuns().filter((run) => run.status === 'running')).toHaveLength(1);
    expect(store.listRuns().filter((run) => run.status === 'queued')).toHaveLength(2);
    expect(semaphore.busy()).toBe(1);

    const queuedStepCounts = new Map(
      store
        .listRuns()
        .filter((run) => run.status === 'queued')
        .map((run) => [run.id, run.steps.filter((step) => step.id.startsWith('continue-')).length]),
    );
    firstManager.dispose();

    // Simulate another process start before the queued continuations receive a
    // slot. They must reconstruct those same Continue jobs, not revive the
    // original quick-task workflow or append duplicate continuation steps.
    const secondManager = new RunManager(store, root, { semaphore });
    managers.push(secondManager);
    holdContinuation(secondManager);
    await secondManager.recover();
    await waitFor(
      () => store.listRuns().filter((run) => run.status === 'running').length === 1,
      'one continuation to take the project slot after the second restart',
    );
    for (const [runId, stepCount] of queuedStepCounts) {
      expect(store.getRun(runId)?.steps.filter((step) => step.id.startsWith('continue-'))).toHaveLength(
        stepCount,
      );
      expect(
        store
          .readEvents(runId)
          .some(
            (event) =>
              event.type === 'lifecycle' &&
              event.message === 'cezar restarted — interrupted continuation re-queued',
          ),
      ).toBe(true);
    }
    expect(store.listRuns().filter((run) => run.status === 'running')).toHaveLength(1);
    expect(store.listRuns().filter((run) => run.status === 'queued')).toHaveLength(2);
    expect(semaphore.busy()).toBe(1);

    // Keep fixture teardown independent of the deliberately unresolved stub.
    for (const run of store.listRuns()) {
      store.updateRun(run.id, { status: 'cancelled', finishedAt: new Date().toISOString() });
    }
  });

  it('restart continuation releases its starting slot after becoming active', async () => {
    const root = fixtureRepo('cez-wsem-recover-starting-', roots);
    const semaphore = new WorkspaceSemaphore({ initial: { maxParallel: 1 } });
    const store = RunStore.open(join(root, '.ai/cezar'), { keepLive: true });
    const manager = new RunManager(store, root, { semaphore });
    stores.push(store);
    managers.push(manager);

    const record = store.createRun({
      title: 'interrupted continuation',
      workflow: 'quick-task',
      task: 'resume after restart',
      runner: 'claude',
      steps: [{ id: 'task', name: 'Task', kind: 'agent' }],
    });
    store.updateStep(record.id, 'task', {
      status: 'running',
      iterations: 1,
      sessionId: 'session-interrupted',
      backend: 'claude',
    });
    store.updateRun(record.id, { status: 'running', currentStepId: 'task' });

    await manager.recover();
    await waitFor(
      () => store.getRun(record.id)?.status === 'waiting',
      'the recovered continuation to finish its mock turn',
    );

    expect(semaphore.busy()).toBe(0);
    expect(
      (manager as unknown as { starting: Set<string> }).starting.has(record.id),
    ).toBe(false);
  });

  it('#347 with a per-project cap: a waiting run on the capped project still resumes immediately', async () => {
    const projectLimits = new Map<string, number>();
    const semaphore = new WorkspaceSemaphore({
      load: () =>
        Promise.resolve({ maxParallel: 4, memoryLimitMb: null, projectLimits: new Map(projectLimits) }),
      initial: { maxParallel: 4 },
    });
    const a = project('cez-wsem-pp347-', semaphore);
    const rootA = a.root;
    projectLimits.set(realpathSync(rootA), 1);
    await semaphore.refresh();

    // Park an agent run at `waiting` (holds no slot per #347), then saturate A's
    // per-project cap of 1 with a running holder.
    const waitingRun = a.manager.startRun(AGENT, { task: 'park and wait', worktree: false });
    await waitFor(() => a.store.getRun(waitingRun.id)?.status === 'waiting', 'the agent run to park');
    const holder = a.manager.startRun(SLOW, { task: 'occupy the single per-project slot' });
    await waitFor(() => a.store.getRun(holder.id)?.status === 'running', "the holder to take A's only slot");

    // Even at A's per-project cap, the resume bypasses pump() — straight into the
    // open session, no slot acquire — so the ceiling can never strand it.
    expect(a.manager.sendMessage(waitingRun.id, [{ type: 'text', text: 'carry on' }])).toBe(true);
    expect(a.store.getRun(waitingRun.id)?.status).toBe('running');
    expect(a.store.getRun(holder.id)?.status).toBe('running'); // holder keeps the single slot
    await waitFor(
      () => a.store.getRun(waitingRun.id)?.status === 'waiting',
      'the resumed run to re-park after its turn',
    );
  }, 45_000);

  it('refresh() applies a raised cap without a restart: the queued run starts', async () => {
    let limits = { maxParallel: 1, memoryLimitMb: null as number | null };
    const semaphore = new WorkspaceSemaphore({
      load: () => Promise.resolve({ ...limits }),
      initial: { maxParallel: 1 },
    });
    const a = project('cez-wsem-refresh-', semaphore);

    const holder = a.manager.startRun(SLOW, { task: 'hold the only slot' });
    const queued = a.manager.startRun(INSTANT, { task: 'wait for capacity' });
    await waitFor(() => a.store.getRun(holder.id)?.status === 'running', 'the holder to run');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(a.store.getRun(queued.id)?.status).toBe('queued');

    // The workspace cache hook (boot / PUT /api/v1/workspace/config, step 2.7):
    // bump the config, refresh — the pump fires and the queued run proceeds
    // while the holder is still running. No process restart involved.
    limits = { maxParallel: 2, memoryLimitMb: null };
    await semaphore.refresh();
    await waitFor(
      () => settled.includes(a.store.getRun(queued.id)?.status ?? ''),
      'the queued run to start and finish after the cap was raised',
    );
    expect(a.store.getRun(queued.id)?.status).toBe('done');
    expect(a.store.getRun(holder.id)?.status).toBe('running'); // still holding — proves no restart/wait
  }, 45_000);
});
