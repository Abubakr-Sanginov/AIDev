import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RuntimeOrchestrator } from '../src/runtimes/runtime-orchestrator.js';
import { MockRuntime } from '../src/runtimes/mock/runtime.js';
import { writeFileTool } from '../src/tools/files.js';
import type { AgentRequest, RuntimeResult, RuntimeSession } from '../src/runtimes/runtime.js';

class RecordingRuntime extends MockRuntime {
  readonly requests: Array<{ roleId: string; request: AgentRequest }> = [];
  override async execute(session: RuntimeSession, request: AgentRequest): Promise<RuntimeResult> {
    this.requests.push({ roleId: session.roleId, request });
    const output =
      session.roleId === 'reviewer'
        ? 'APPROVED'
        : session.roleId === 'tester'
          ? 'VERDICT: PASS'
          : `${session.roleId} artifact`;
    return { success: true, output, sessionId: session.id, exitCode: 0 };
  }
}

describe('runtime workflow regressions', () => {
  it('routes full-stack work to specialized roles with correct policies and handoffs', async () => {
    const runtime = new RecordingRuntime();
    const state = await new RuntimeOrchestrator({ root: '.', runtime }).run(
      'Build a full-stack API and web dashboard',
    );
    expect(state.status).toBe('DONE');
    expect(state.totalPhases).toBe(6);
    expect(state.completedPhases).toBe(6);
    expect(runtime.requests.map(({ roleId }) => roleId)).toEqual([
      'manager',
      'architect',
      'backend',
      'frontend',
      'tester',
      'reviewer',
    ]);
    expect(runtime.requests.map(({ request }) => request.toolPolicy)).toEqual([
      'read-only',
      'coding',
      'coding',
      'coding',
      'read-only',
      'read-only',
    ]);
    expect(runtime.requests.find(({ roleId }) => roleId === 'frontend')?.request.prompt).toContain(
      '## backend\nbackend artifact',
    );
  });

  it('does not add an execution timeout to role requests', async () => {
    const runtime = new RecordingRuntime();
    await new RuntimeOrchestrator({ root: '.', runtime }).run('Update configuration');
    expect(runtime.requests).not.toHaveLength(0);
    for (const { request } of runtime.requests) expect(request).not.toHaveProperty('timeoutMs');
  });

  it('rejects a claimed implementation with no target artifacts and terminalizes agents', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'empty-target-'));
    try {
      const runtime = new RecordingRuntime();
      const state = await new RuntimeOrchestrator({ root, runtime, maxFixAttempts: 1 }).run(
        'Create a small project',
      );
      expect(state.status).toBe('FAILED');
      expect(state.attempts).toBe(1);
      expect(runtime.requests.map(({ roleId }) => roleId)).toContain('fixer');
      expect(runtime.requests.find(({ roleId }) => roleId === 'coder')?.request.prompt).toContain(
        `Target project directory: ${root}`,
      );
      const latest = new Map(state.events.map((event) => [event.roleId, event.status]));
      expect([...latest.values()]).not.toContain('ACTIVE');
      expect([...latest.values()]).not.toContain('RUNNING');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('allows fixer-created artifacts to proceed through retest and review', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'fixed-target-'));
    try {
      class FixingRuntime extends RecordingRuntime {
        override async execute(
          session: RuntimeSession,
          request: AgentRequest,
        ): Promise<RuntimeResult> {
          if (session.roleId === 'fixer')
            await writeFileTool.execute(
              { path: 'index.ts', content: 'export {};\n' },
              { root, approve: async () => false },
            );
          return super.execute(session, request);
        }
      }
      const runtime = new FixingRuntime();
      const state = await new RuntimeOrchestrator({ root, runtime, maxFixAttempts: 1 }).run(
        'Create a small project',
      );
      expect(state.status).toBe('DONE');
      expect(await readFile(path.join(root, 'index.ts'), 'utf8')).toBe('export {};\n');
      expect(runtime.requests.map(({ roleId }) => roleId)).toEqual([
        'manager',
        'architect',
        'coder',
        'coder',
        'coder',
        'tester',
        'fixer',
        'tester',
        'reviewer',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not report success when defects remain or review requests changes', async () => {
    class RejectingRuntime extends RecordingRuntime {
      override async execute(
        session: RuntimeSession,
        request: AgentRequest,
      ): Promise<RuntimeResult> {
        this.requests.push({ roleId: session.roleId, request });
        const output =
          session.roleId === 'tester'
            ? 'VERDICT: FAIL - defect remains'
            : session.roleId === 'reviewer'
              ? 'CHANGES_REQUIRED'
              : 'artifact';
        return { success: true, output, sessionId: session.id, exitCode: 0 };
      }
    }
    const runtime = new RejectingRuntime();
    const state = await new RuntimeOrchestrator({ root: '.', runtime, maxFixAttempts: 1 }).run(
      'Update configuration',
    );
    expect(state.status).toBe('FAILED');
    expect(state.attempts).toBe(1);
    expect(runtime.requests.map(({ roleId }) => roleId)).toEqual([
      'manager',
      'architect',
      'coder',
      'tester',
      'fixer',
      'tester',
    ]);
    expect(
      state.events.some((event) => event.roleId === 'reviewer' && event.status === 'SKIPPED'),
    ).toBe(true);
  });

  it('ends cleanly after bounded retry exhaustion without contradictory terminal activity', async () => {
    class BrokenReviewerRuntime extends RecordingRuntime {
      override async execute(
        session: RuntimeSession,
        request: AgentRequest,
      ): Promise<RuntimeResult> {
        if (session.roleId === 'reviewer') throw new Error('review transport unavailable');
        return super.execute(session, request);
      }
    }
    const state = await new RuntimeOrchestrator({
      root: '.',
      runtime: new BrokenReviewerRuntime(),
      maxAgentAttempts: 2,
      retryBackoffMs: 0,
    }).run('Update configuration');
    expect(state.status).toBe('FAILED');
    expect(state.sessions.filter((session) => session.roleId === 'reviewer')).toHaveLength(2);
    const reviewer = state.events.filter((event) => event.roleId === 'reviewer');
    expect(reviewer.at(-1)?.status).toBe('FAILED');
    expect(reviewer.at(-1)?.message).toMatch(/Retry limit exhausted/);
    const lastFailed = reviewer.reduce(
      (index, event, current) => (event.status === 'FAILED' ? current : index),
      -1,
    );
    expect(reviewer.slice(lastFailed + 1).some((event) => event.status === 'ACTIVE')).toBe(false);
  });
});
