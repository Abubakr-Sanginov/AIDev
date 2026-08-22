import { describe, expect, it, vi } from 'vitest';
import type {
  AgentRequest,
  AuthResult,
  CodingRuntime,
  InstallInstructions,
  InstallResult,
  LaunchOptions,
  RuntimeDetection,
  RuntimeResult,
  RuntimeSession,
  RuntimeState,
} from '../src/runtimes/runtime.js';
import { RuntimeOrchestrator } from '../src/runtimes/runtime-orchestrator.js';
import { isReadOnlyRole } from '../src/roles.js';
import { CodexRuntime } from '../src/runtimes/codex/runtime.js';
import { ClaudeCodeRuntime } from '../src/runtimes/claude-code/runtime.js';
import type { ProcessRunner } from '../src/runtimes/process.js';
import type {
  TerminalLauncher,
  TerminalOptions,
  TerminalProcess,
} from '../src/terminal/terminal.js';

type ScriptedBehavior =
  { kind: 'success'; output: string } | { kind: 'failure'; output: string } | { kind: 'timeout' };

const DEFAULT_BEHAVIOR: ScriptedBehavior = { kind: 'success', output: 'VERDICT: PASS' };

class RecordingRuntime implements CodingRuntime {
  readonly id = 'recording';
  readonly name = 'Recording Runtime';
  readonly executions: Array<{ roleId: string; request: AgentRequest }> = [];
  readonly launchedRoleIds: string[] = [];
  readonly #script: Readonly<Record<string, readonly ScriptedBehavior[]>>;
  readonly #callCounts = new Map<string, number>();
  constructor(script: Readonly<Record<string, readonly ScriptedBehavior[]>>) {
    this.#script = script;
  }
  async detect(): Promise<RuntimeDetection> {
    return { installed: true, ready: true, authenticated: 'yes', version: '1.0.0' };
  }
  getInstallInstructions(): InstallInstructions {
    return { command: '', description: 'Headless recording harness for tests.', officialUrl: '' };
  }
  async install(): Promise<InstallResult> {
    return { success: true, message: 'installed' };
  }
  async authenticate(): Promise<AuthResult> {
    return { success: true, message: 'ready' };
  }
  async discoverModels(): Promise<{ models: string[] }> {
    return { models: [] };
  }
  async launch(options: LaunchOptions): Promise<RuntimeSession> {
    this.launchedRoleIds.push(options.roleId);
    return {
      id: `session-${options.roleId}`,
      runtimeId: this.id,
      roleId: options.roleId,
      workingDirectory: options.workingDirectory,
      status: 'running',
      createdAt: new Date().toISOString(),
    };
  }
  async execute(session: RuntimeSession, request: AgentRequest): Promise<RuntimeResult> {
    this.executions.push({ roleId: session.roleId, request });
    const index = this.#callCounts.get(session.roleId) ?? 0;
    this.#callCounts.set(session.roleId, index + 1);
    const queue = this.#script[session.roleId];
    const behavior =
      queue === undefined
        ? DEFAULT_BEHAVIOR
        : (queue[Math.min(index, queue.length - 1)] ?? DEFAULT_BEHAVIOR);
    if (behavior.kind === 'timeout') throw new Error(`${session.roleId} timed out`);
    if (behavior.kind === 'failure') {
      session.status = 'failed';
      return { success: false, output: behavior.output, sessionId: session.id, exitCode: 1 };
    }
    session.status = 'completed';
    return { success: true, output: behavior.output, sessionId: session.id, exitCode: 0 };
  }
  async pause(session: RuntimeSession) {
    session.status = 'paused';
  }
  async resume(session: RuntimeSession) {
    session.status = 'running';
  }
  async stop(session: RuntimeSession) {
    session.status = 'stopped';
  }
  async getStatus(session: RuntimeSession): Promise<RuntimeState> {
    return session.status;
  }
}

class TestTerminal implements TerminalLauncher {
  readonly calls: TerminalOptions[] = [];
  async open(options: TerminalOptions): Promise<TerminalProcess> {
    this.calls.push(options);
    return { command: options.command, processId: 99 };
  }
}

describe('runtime orchestration', () => {
  it('assigns both implementers for full-stack goals', async () => {
    const runtime = new RecordingRuntime({
      manager: [{ kind: 'success', output: 'plan' }],
      architect: [{ kind: 'success', output: 'architecture' }],
      backend: [{ kind: 'success', output: 'api' }],
      frontend: [{ kind: 'success', output: 'ui' }],
      reviewer: [{ kind: 'success', output: 'APPROVED' }],
    });
    const state = await new RuntimeOrchestrator({ root: '.', runtime }).run(
      'Build a full-stack storefront with a RESTful API',
    );
    expect(state.status).toBe('DONE');
    expect(state.sessions.map((session) => session.roleId)).toEqual([
      'manager',
      'architect',
      'backend',
      'frontend',
      'tester',
      'reviewer',
    ]);
  });

  it('routes API goals to the backend implementer only', async () => {
    const runtime = new RecordingRuntime({
      backend: [{ kind: 'success', output: 'api' }],
      reviewer: [{ kind: 'success', output: 'APPROVED' }],
    });
    const state = await new RuntimeOrchestrator({ root: '.', runtime }).run('Build a TODO API');
    expect(state.status).toBe('DONE');
    expect(runtime.launchedRoleIds).toEqual([
      'manager',
      'architect',
      'backend',
      'tester',
      'reviewer',
    ]);
    expect(
      state.events.some((event) => event.roleId === 'frontend' && event.status === 'SKIPPED'),
    ).toBe(true);
  });

  it('routes portfolio and website goals to the frontend implementer', async () => {
    const runtime = new RecordingRuntime({
      frontend: [{ kind: 'success', output: 'ui' }],
      reviewer: [{ kind: 'success', output: 'APPROVED' }],
    });
    const state = await new RuntimeOrchestrator({ root: '.', runtime }).run(
      'Сделай сайт-портфолио',
    );
    expect(state.status).toBe('DONE');
    expect(runtime.launchedRoleIds).toEqual([
      'manager',
      'architect',
      'frontend',
      'tester',
      'reviewer',
    ]);
    expect(
      state.events.some((event) => event.roleId === 'backend' && event.status === 'SKIPPED'),
    ).toBe(true);
  });

  it('falls back to a general coder without a stack signal', async () => {
    const runtime = new RecordingRuntime({ coder: [{ kind: 'success', output: 'done' }] });
    const state = await new RuntimeOrchestrator({ root: '.', runtime }).run(
      'Write a haiku about rain',
    );
    expect(state.status).toBe('DONE');
    expect(runtime.launchedRoleIds).toEqual([
      'manager',
      'architect',
      'coder',
      'tester',
      'reviewer',
    ]);
  });

  it('does not treat "no defects" as a failed tester report', async () => {
    const runtime = new RecordingRuntime({
      coder: [{ kind: 'success', output: 'done' }],
      tester: [{ kind: 'success', output: 'Checks complete. Defects: none.' }],
      reviewer: [{ kind: 'success', output: 'APPROVED' }],
    });
    const state = await new RuntimeOrchestrator({ root: '.', runtime }).run('Write a haiku');
    expect(state.status).toBe('DONE');
    expect(runtime.launchedRoleIds).not.toContain('fixer');
  });

  it('enforces read-only tool policy on non-implementing roles', async () => {
    const runtime = new RecordingRuntime({ coder: [{ kind: 'success', output: 'done' }] });
    await new RuntimeOrchestrator({ root: '.', runtime }).run('Write a haiku about rain');
    for (const entry of runtime.executions) {
      expect(entry.request.toolPolicy).toBe(isReadOnlyRole(entry.roleId) ? 'read-only' : 'coding');
    }
    expect(runtime.executions.filter((entry) => isReadOnlyRole(entry.roleId))).toHaveLength(3);
  });

  it('retries a transient tester timeout, reaches the reviewer, and ends resolved', async () => {
    const runtime = new RecordingRuntime({
      manager: [{ kind: 'success', output: 'plan' }],
      backend: [{ kind: 'success', output: 'api' }],
      tester: [{ kind: 'timeout' }, { kind: 'success', output: 'VERDICT: PASS' }],
      reviewer: [{ kind: 'success', output: 'APPROVED' }],
    });
    const state = await new RuntimeOrchestrator({ root: '.', runtime, retryBackoffMs: 0 }).run(
      'Build a TODO API',
    );
    expect(state.status).toBe('DONE');
    expect(state.events.some((event) => event.status === 'RETRYING')).toBe(true);
    expect(state.sessions.map((session) => session.roleId)).toEqual([
      'manager',
      'architect',
      'backend',
      'tester',
      'tester',
      'reviewer',
    ]);
    for (const roleId of ['manager', 'architect', 'backend', 'tester', 'reviewer']) {
      const events = state.events.filter((event) => event.roleId === roleId);
      expect(events.at(-1)?.status).not.toBe('RUNNING');
    }
  });

  it('only enables fixer and retest after the tester reports defects', async () => {
    const runtime = new RecordingRuntime({
      backend: [{ kind: 'success', output: 'api' }],
      tester: [
        { kind: 'success', output: 'VERDICT: FAIL' },
        { kind: 'success', output: 'VERDICT: PASS' },
      ],
      fixer: [{ kind: 'success', output: 'fixed' }],
      reviewer: [{ kind: 'success', output: 'APPROVED' }],
    });
    const state = await new RuntimeOrchestrator({ root: '.', runtime }).run('Build a TODO API');
    expect(state.status).toBe('DONE');
    expect(state.attempts).toBe(1);
    expect(runtime.launchedRoleIds).toEqual([
      'manager',
      'architect',
      'backend',
      'tester',
      'fixer',
      'tester',
      'reviewer',
    ]);
  });

  it('caps fix attempts at maxFixAttempts when defects persist', async () => {
    const runtime = new RecordingRuntime({
      backend: [{ kind: 'success', output: 'api' }],
      tester: [{ kind: 'success', output: 'VERDICT: FAIL' }],
      fixer: [{ kind: 'success', output: 'fixed' }],
      reviewer: [{ kind: 'success', output: 'CHANGES_REQUIRED' }],
    });
    const state = await new RuntimeOrchestrator({ root: '.', runtime, maxFixAttempts: 2 }).run(
      'Build a TODO API',
    );
    expect(state.attempts).toBe(2);
    expect(runtime.launchedRoleIds.filter((roleId) => roleId === 'tester')).toHaveLength(3);
    expect(state.status).toBe('FAILED');
  });

  it('marks a role FAILED only after every attempt is exhausted', async () => {
    const runtime = new RecordingRuntime({
      coder: [
        { kind: 'failure', output: 'write failed' },
        { kind: 'failure', output: 'write failed' },
        { kind: 'success', output: 'implemented' },
      ],
      reviewer: [{ kind: 'success', output: 'APPROVED' }],
    });
    const state = await new RuntimeOrchestrator({ root: '.', runtime, retryBackoffMs: 0 }).run(
      'Write a haiku about rain',
    );
    const coderEvents = state.events.filter((event) => event.roleId === 'coder');
    expect(coderEvents.some((event) => event.status === 'FAILED')).toBe(false);
    expect(coderEvents.filter((event) => event.status === 'RETRYING')).toHaveLength(2);
    expect(coderEvents.at(-1)?.status).toBe('DONE');
    expect(runtime.launchedRoleIds.filter((roleId) => roleId === 'coder')).toHaveLength(3);
    expect(state.status).toBe('DONE');
  });

  it('emits a single FAILED event at the end when all attempts fail', async () => {
    const runtime = new RecordingRuntime({
      coder: [{ kind: 'failure', output: 'nope' }],
    });
    const state = await new RuntimeOrchestrator({
      root: '.',
      runtime,
      maxAgentAttempts: 2,
      retryBackoffMs: 0,
    }).run('Write a haiku about rain');
    const coderEvents = state.events.filter((event) => event.roleId === 'coder');
    const failed = coderEvents.filter((event) => event.status === 'FAILED');
    expect(failed).toHaveLength(1);
    expect(coderEvents.at(-1)?.status).toBe('FAILED');
    expect(failed[0]?.message).toMatch(/Retry limit exhausted/);
  });

  it('keeps the manager read-only through a real Codex adapter', async () => {
    const captured: string[][] = [];
    const run = vi.fn<ProcessRunner>(async (_command, args) => {
      captured.push(args);
      return {
        code: 0,
        stdout: '{"type":"item.completed","item":{"type":"agent_message","text":"result"}}\n',
        stderr: '',
      };
    });
    const terminal = new TestTerminal();
    const state = await new RuntimeOrchestrator({
      root: '.',
      runtime: new CodexRuntime(terminal, run),
      visibleRuntime: false,
    }).run('Build a TODO API');
    expect(state.sessions).toHaveLength(5);
    expect(terminal.calls).toHaveLength(0);
    expect(captured.map((args) => args[args.indexOf('--sandbox') + 1])).toEqual([
      'read-only',
      'workspace-write',
      'workspace-write',
      'read-only',
      'read-only',
    ]);
  });

  it('keeps the manager read-only through a real Claude Code adapter', async () => {
    const captured: string[][] = [];
    const run = vi.fn<ProcessRunner>(async (_command, args) => {
      captured.push(args);
      return { code: 0, stdout: JSON.stringify({ result: 'done', session_id: 's' }), stderr: '' };
    });
    const state = await new RuntimeOrchestrator({
      root: '.',
      runtime: new ClaudeCodeRuntime(new TestTerminal(), run),
      visibleRuntime: false,
    }).run('Build a TODO API');
    expect(state.sessions).toHaveLength(5);
    expect(captured[0] ?? []).toContain('--disallowedTools');
    expect(captured[1] ?? []).not.toContain('--disallowedTools');
    expect(captured[3] ?? []).toContain('--disallowedTools');
    expect(captured[4] ?? []).toContain('--disallowedTools');
  });
});
