import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MockRuntime } from '../src/runtimes/mock/runtime.js';
import { RuntimeRegistry } from '../src/runtimes/registry.js';
import { RuntimeOrchestrator, workflowProgress } from '../src/runtimes/runtime-orchestrator.js';

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

describe('runtime architecture', () => {
  it('registers and resolves plugins', () => {
    const registry = new RuntimeRegistry();
    const runtime = new MockRuntime();
    registry.register(runtime);
    expect(registry.get('mock')).toBe(runtime);
    expect(registry.list()).toEqual([runtime]);
  });
  it('executes failure, fixer, retry, and review across real sessions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'runtime-'));
    directories.push(root);
    await writeFile(path.join(root, 'existing-project.txt'), 'fixture');
    const runtime = new MockRuntime([
      { behavior: 'success', output: 'plan' },
      { behavior: 'success', output: 'architecture' },
      { behavior: 'success', output: 'implementation' },
      { behavior: 'failure', output: 'VERDICT: FAIL' },
      { behavior: 'success', output: 'fixed' },
      { behavior: 'success', output: 'VERDICT: PASS' },
      { behavior: 'success', output: 'VERDICT: PASS' },
    ]);
    const state = await new RuntimeOrchestrator({ root, runtime }).run('Build a TODO API');
    expect(state.status).toBe('DONE');
    expect(state.attempts).toBe(1);
    expect(state.sessions).toHaveLength(7);
    expect(state.events.map((event) => event.roleId)).toContain('fixer');
  });
  it('models timeout and crash failures', async () => {
    const runtime = new MockRuntime([{ behavior: 'timeout' }]);
    const session = await runtime.launch({ workingDirectory: '.', roleId: 'tester' });
    await expect(runtime.execute(session, { prompt: 'test' })).rejects.toThrow(/timed out/);
  });
  it('surfaces follower launch failures as meaningful activity', async () => {
    class TerminalFailureRuntime extends MockRuntime {
      override async launch(options: Parameters<MockRuntime['launch']>[0]) {
        const session = await super.launch(options);
        session.terminalError = 'Start-Process access denied';
        return session;
      }
    }
    const state = await new RuntimeOrchestrator({
      root: '.',
      runtime: new TerminalFailureRuntime(),
      visibleRuntime: true,
    }).run('test');
    expect(state.events.map((event) => event.message)).toContain(
      'Warning: runtime terminal could not be opened: Start-Process access denied',
    );
  });
  it('derives overall progress only from completed scheduled phases', () => {
    expect(
      workflowProgress({
        goal: 'test',
        runtimeId: 'mock',
        status: 'RUNNING',
        attempts: 0,
        sessions: [],
        events: [],
        completedPhases: 2,
        totalPhases: 5,
      }),
    ).toEqual({ completed: 2, total: 5 });
  });
  it('keeps mock execution headless and updates liveness without heartbeat history', async () => {
    class SlowMock extends MockRuntime {
      override async execute(session: Parameters<MockRuntime['execute']>[0]) {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return super.execute(session, { prompt: 'test' });
      }
    }
    const states: string[][] = [];
    await new RuntimeOrchestrator({
      root: '.',
      runtime: new SlowMock(),
      heartbeatMs: 2,
      onState: (state) => {
        states.push(state.events.map((event) => event.status));
      },
    }).run('test');
    expect(states.length).toBeGreaterThan(12);
    expect(states.flat().some((status) => status === 'ACTIVE')).toBe(false);
  });
  it('recovers from runtime failures, never waits on a failed role, and ignores late activity', async () => {
    class LateActivityRuntime extends MockRuntime {
      stopped = false;
      late?: Promise<void>;
      override async execute(
        session: Parameters<MockRuntime['execute']>[0],
        request: Parameters<MockRuntime['execute']>[1],
      ): ReturnType<MockRuntime['execute']> {
        this.late = new Promise<void>((resolve) =>
          setTimeout(() => {
            void Promise.resolve(
              request.onActivity?.({ type: 'output', message: 'OpenCode event: tool_use' }),
            ).then(() => resolve());
          }, 5),
        );
        throw new Error('Runtime timed out after 5ms.');
      }
      override async stop(session: Parameters<MockRuntime['stop']>[0]) {
        this.stopped = true;
        await super.stop(session);
      }
    }
    const runtime = new LateActivityRuntime();
    const snapshots: Array<{ status: string; messages: string[] }> = [];
    const state = await new RuntimeOrchestrator({
      root: '.',
      runtime,
      heartbeatMs: 1,
      onState: async (snapshot) => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        snapshots.push({
          status: snapshot.status,
          messages: snapshot.events.map((event) => event.message),
        });
      },
    }).run('test');
    await runtime.late;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(runtime.stopped).toBe(true);
    expect(state.status).toBe('FAILED');
    expect(state.sessions.map((session) => session.roleId)).not.toContain('reviewer');
    expect(
      state.events.some((event) => event.roleId === 'reviewer' && event.status === 'SKIPPED'),
    ).toBe(true);
    expect(state.events.some((event) => event.message === 'Runtime timed out after 5ms.')).toBe(
      true,
    );
    expect(state.events.some((event) => event.status === 'RETRYING')).toBe(true);
    const attempted = ['manager', 'architect', 'coder', 'tester', 'reviewer'];
    for (const roleId of attempted)
      expect(state.events.some((event) => event.roleId === roleId)).toBe(true);
    expect(snapshots.flatMap((snapshot) => snapshot.messages)).not.toContain(
      'OpenCode event: tool_use',
    );
  });
});

it('handles state persistence failure without crashing execution', async () => {
  const failures: string[] = [];
  const state = await new RuntimeOrchestrator({
    root: '.',
    runtime: new MockRuntime(),
    onState: async () => {
      throw Object.assign(new Error('EPERM state.json'), { code: 'EPERM' });
    },
    onStateError: (error) => {
      failures.push(error instanceof Error ? error.message : String(error));
    },
  }).run('test');
  expect(state.status).toBe('DONE');
  expect(failures.length).toBeGreaterThan(0);
});
