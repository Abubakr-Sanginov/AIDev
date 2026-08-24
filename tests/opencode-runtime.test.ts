import { describe, expect, it, vi } from 'vitest';
import {
  buildOpenCodeRunArgs,
  formatOpenCodeLogLine,
  OpenCodeRuntime,
  parseOpenCodeJsonEvents,
  parseOpenCodeVerboseModels,
  summarizeOpenCodeFailure,
} from '../src/runtimes/opencode/runtime.js';
import { autoModelCandidates } from '../src/runtimes/model-selection.js';
import { isFatalDiagnostic } from '../src/runtimes/failure-policy.js';
import type { ProcessRunner } from '../src/runtimes/process.js';
import type {
  TerminalLauncher,
  TerminalOptions,
  TerminalProcess,
} from '../src/terminal/terminal.js';

class TestTerminal implements TerminalLauncher {
  readonly calls: TerminalOptions[] = [];
  async open(options: TerminalOptions): Promise<TerminalProcess> {
    this.calls.push(options);
    return { command: options.command, processId: 123 };
  }
}

function runner(
  implementation: ProcessRunner,
): ProcessRunner & ReturnType<typeof vi.fn<ProcessRunner>> {
  return vi.fn(implementation);
}

describe('OpenCodeRuntime', () => {
  it('detects availability and parses a stable version', async () => {
    const run = runner(async () => ({ code: 0, stdout: 'opencode version 1.2.3\n', stderr: '' }));
    const runtime = new OpenCodeRuntime(new TestTerminal(), run);

    await expect(runtime.detect()).resolves.toEqual({
      installed: true,
      ready: true,
      authenticated: 'unknown',
      version: '1.2.3',
    });
    expect(run).toHaveBeenCalledWith('opencode', ['--version'], process.cwd(), 10_000);
  });

  it('reports a missing executable without claiming readiness', async () => {
    const run = runner(async () => {
      throw new Error('ENOENT');
    });
    await expect(new OpenCodeRuntime(new TestTerminal(), run).detect()).resolves.toMatchObject({
      installed: false,
      ready: false,
      message: 'OpenCode command was not found.',
    });
  });

  it('constructs official run, model, and exact session arguments', () => {
    expect(buildOpenCodeRunArgs({ prompt: 'Do the work' })).toEqual(['run', '--format', 'json']);
    expect(
      buildOpenCodeRunArgs({
        prompt: 'Continue',
        resumeSessionId: 'ses_123',
        model: 'provider/model',
      }),
    ).toEqual(['run', '--format', 'json', '--model', 'provider/model', '--session', 'ses_123']);
  });

  it('runs coding roles on the full-access build agent with auto-approved permissions', () => {
    expect(buildOpenCodeRunArgs({ prompt: 'Implement it', toolPolicy: 'coding' })).toEqual([
      'run',
      '--format',
      'json',
      '--agent',
      'build',
      '--auto',
    ]);
    expect(buildOpenCodeRunArgs({ prompt: 'Audit it', toolPolicy: 'read-only' })).toEqual([
      'run',
      '--format',
      'json',
    ]);
  });

  it('discovers models with cost metadata and marks the free tier', async () => {
    const verbose = [
      'standardcompute/standardcompute',
      '{',
      '  "id": "standardcompute",',
      '  "providerID": "standardcompute",',
      '  "cost": { "input": 0.5, "output": 1.5, "cache": { "read": 0, "write": 0 } },',
      '}',
      'opencode/big-pickle',
      '{',
      '  "id": "big-pickle",',
      '  "providerID": "opencode",',
      '  "cost": { "input": 0, "output": 0 },',
      '}',
      'opencode/hy3-free',
      '{',
      '  "id": "hy3-free",',
      '  "providerID": "opencode"',
      '}',
    ].join('\n');
    const run = runner(async (_command, args) => ({
      code: 0,
      stdout: args.includes('--verbose') ? verbose : '',
      stderr: '',
    }));
    const runtime = new OpenCodeRuntime(new TestTerminal(), run);
    await expect(runtime.discoverModels('C:\\work')).resolves.toEqual({
      models: ['standardcompute/standardcompute', 'opencode/big-pickle', 'opencode/hy3-free'],
      freeModels: ['opencode/big-pickle', 'opencode/hy3-free'],
    });
    expect(run).toHaveBeenCalledWith('opencode', ['models', '--verbose'], 'C:\\work', 60_000);
  });

  it('falls back to plain model listing when verbose output is unsupported', async () => {
    const run = runner(async (_command, args) => ({
      code: 0,
      stdout: args[0] === 'models' && !args.includes('--verbose')
        ? 'anthropic/one\nopenai/two\nanthropic/one\n'
        : '',
      stderr: '',
    }));
    const runtime = new OpenCodeRuntime(new TestTerminal(), run);
    await expect(runtime.discoverModels('C:\\work')).resolves.toEqual({
      models: ['anthropic/one', 'openai/two'],
    });
  });

  it('parses verbose model blocks and detects zero-cost tiers', () => {
    const infos = parseOpenCodeVerboseModels(
      [
        'a/paid',
        '{ "id": "paid", "cost": { "input": 3, "output": 15 } }',
        'opencode/big-pickle',
        '{\n  "id": "big-pickle",\n  "providerID": "opencode",\n  "cost": {\n    "input": 0,\n    "output": 0\n  }\n}',
        'c/suffix-free',
        '{}',
        'std/ambiguous',
        '{\n  "id": "ambiguous",\n  "providerID": "std",\n  "cost": {\n    "input": 0,\n    "output": 0\n  }\n}',
      ].join('\n'),
    );
    expect(infos).toEqual([
      { id: 'a/paid', free: false },
      { id: 'opencode/big-pickle', free: true },
      { id: 'c/suffix-free', free: true },
      // Custom providers report 0/0 when no pricing is published; that does
      // not make them free-tier, so they sort after genuinely free models.
      { id: 'std/ambiguous', free: false },
    ]);
  });

  it('orders Auto candidates free-first across all providers', () => {
    expect(
      autoModelCandidates({
        models: ['xpeach/claude-opus-5', 'opencode/hy3-free', 'oxalpha/ox-alpha'],
        freeModels: ['opencode/hy3-free'],
      }),
    ).toEqual(['opencode/hy3-free', 'xpeach/claude-opus-5', 'oxalpha/ox-alpha']);
    expect(autoModelCandidates({ models: ['only/one'] })).toEqual(['only/one']);
  });

  it('parses NDJSON events, text parts, and the session ID', () => {
    const result = parseOpenCodeJsonEvents(
      [
        JSON.stringify({ type: 'session', sessionID: 'ses_abc' }),
        JSON.stringify({ type: 'text', part: { text: 'Hello ' } }),
        JSON.stringify({ type: 'text', part: { text: 'world' } }),
      ].join('\n'),
    );
    expect(result).toEqual({ output: 'Hello world', sessionId: 'ses_abc' });
  });

  it('provides useful malformed and error-only event messages', () => {
    expect(() => parseOpenCodeJsonEvents('{"type":"text"}\nnot-json')).toThrow(
      'OpenCode returned invalid JSON on event line 2.',
    );
    expect(() =>
      parseOpenCodeJsonEvents(JSON.stringify({ type: 'error', error: { message: 'No provider' } })),
    ).toThrow('OpenCode JSON event stream contained no textual result. No provider');
  });

  it('summarizes nonzero JSON event failures into readable messages', () => {
    const stdout = [
      JSON.stringify({ type: 'session', sessionID: 'ses_1' }),
      JSON.stringify({
        type: 'error',
        timestamp: 1787498552844,
        sessionID: 'ses_1',
        error: { name: 'ProviderAuthError', message: 'Provider is not authenticated.' },
      }),
    ].join('\n');
    expect(summarizeOpenCodeFailure({ code: 2, stdout, stderr: '' })).toBe(
      'OpenCode exited with code 2: Provider is not authenticated.',
    );
    expect(summarizeOpenCodeFailure({ code: 7, stdout: '', stderr: 'provider failed' })).toBe(
      'provider failed',
    );
  });

  it('surfaces nested provider APIError details and the HTTP status', () => {
    const stdout = JSON.stringify({
      type: 'error',
      timestamp: 1787538339460,
      sessionID: 'ses_fce',
      error: {
        name: 'APIError',
        data: {
          message: 'That was the last of your free trial — add a plan to continue.',
          statusCode: 402,
          isRetryable: false,
        },
      },
    });
    expect(summarizeOpenCodeFailure({ code: 1, stdout, stderr: '' })).toBe(
      'OpenCode exited with code 1: APIError (HTTP 402): That was the last of your free trial — add a plan to continue.',
    );
    expect(isFatalDiagnostic(summarizeOpenCodeFailure({ code: 1, stdout, stderr: '' }))).toBe(true);
  });

  it('formats log lines as human-readable timestamped events', () => {
    const now = new Date('2026-08-24T10:20:30');
    const stamp = new Date(1787538339460);
    const time = stamp.toLocaleTimeString('en-GB', { hour12: false });
    expect(
      formatOpenCodeLogLine(JSON.stringify({ type: 'step_start', timestamp: 1787538339460 }), '', now),
    ).toBe(`[${time}] step_start`);
    expect(
      formatOpenCodeLogLine(
        JSON.stringify({
          type: 'error',
          timestamp: 1787538339460,
          error: { name: 'APIError', data: { message: 'quota exhausted', statusCode: 402 } },
        }),
        '',
        now,
      ),
    ).toContain('error: APIError (HTTP 402): quota exhausted');
    expect(formatOpenCodeLogLine('plain diagnostic text', '', now)).toBe('plain diagnostic text');
    expect(formatOpenCodeLogLine('   ', '', now)).toBeUndefined();
  });

  it('persists a returned session ID and resumes it on the next execution', async () => {
    const run = runner(async (_command, args) => ({
      code: 0,
      stdout: args.includes('--session')
        ? JSON.stringify({ type: 'text', sessionID: 'ses_abc', part: { text: 'second' } })
        : JSON.stringify({ type: 'text', sessionID: 'ses_abc', part: { text: 'first' } }),
      stderr: '',
    }));
    const runtime = new OpenCodeRuntime(new TestTerminal(), run);
    const session = await runtime.launch({ workingDirectory: '.', roleId: 'coder' });

    await expect(runtime.execute(session, { prompt: 'First' })).resolves.toMatchObject({
      success: true,
      output: 'first',
      sessionId: 'ses_abc',
    });
    await runtime.execute(session, { prompt: 'Second' });
    expect(run).toHaveBeenLastCalledWith(
      'opencode',
      ['run', '--format', 'json', '--session', 'ses_abc'],
      '.',
      undefined,
      expect.any(Function),
      'Second',
    );
  });

  it('forces a read-only permission config for read-only policy runs and restores it', async () => {
    let observed: string | undefined;
    const run = runner(async (_command, _args) => {
      observed = process.env.OPENCODE_CONFIG_CONTENT;
      return { code: 0, stdout: '{"type":"text","part":{"text":"audited"}}', stderr: '' };
    });
    const runtime = new OpenCodeRuntime(new TestTerminal(), run);
    const session = await runtime.launch({ workingDirectory: '.', roleId: 'coder' });

    await runtime.execute(session, { prompt: 'Audit codewise', toolPolicy: 'read-only' });

    expect(observed).toBe(JSON.stringify({ permission: { bash: 'deny', edit: 'deny' } }));
    expect(process.env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
    expect(run).toHaveBeenCalledWith(
      'opencode',
      ['run', '--format', 'json'],
      '.',
      undefined,
      expect.any(Function),
      'Audit codewise',
    );
  });

  it('does not override the config environment for coding policy runs', async () => {
    let observed: string | undefined = 'unset-marker';
    const run = runner(async (_command, _args) => {
      observed = process.env.OPENCODE_CONFIG_CONTENT;
      return { code: 0, stdout: '{"type":"text","part":{"text":"done"}}', stderr: '' };
    });
    const runtime = new OpenCodeRuntime(new TestTerminal(), run);
    const session = await runtime.launch({ workingDirectory: '.', roleId: 'coder' });

    await runtime.execute(session, { prompt: 'Build feature', toolPolicy: 'coding' });

    expect(observed).toBeUndefined();
    expect(process.env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
    expect(run).toHaveBeenCalledWith(
      'opencode',
      ['run', '--format', 'json', '--agent', 'build', '--auto'],
      '.',
      undefined,
      expect.any(Function),
      'Build feature',
    );
  });

  it('handles nonzero exits and marks the session failed', async () => {
    const run = runner(async () => ({ code: 7, stdout: '', stderr: 'provider failed' }));
    const runtime = new OpenCodeRuntime(new TestTerminal(), run);
    const session = await runtime.launch({ workingDirectory: '.', roleId: 'tester' });
    await expect(runtime.execute(session, { prompt: 'Test' })).resolves.toEqual({
      success: false,
      output: 'provider failed',
      exitCode: 7,
    });
    await expect(runtime.getStatus(session)).resolves.toBe('failed');
  });

  it('surfaces timeout or process crashes and marks the session failed', async () => {
    const run = runner(async () => {
      throw new Error('Runtime timed out after 5ms.');
    });
    const runtime = new OpenCodeRuntime(new TestTerminal(), run);
    const session = await runtime.launch({ workingDirectory: '.', roleId: 'tester' });
    await expect(runtime.execute(session, { prompt: 'Test' })).rejects.toThrow(
      'OpenCode execution failed: Runtime timed out after 5ms.',
    );
    await expect(runtime.getStatus(session)).resolves.toBe('failed');
  });

  it('uses official installation and visible TUI launch shapes', async () => {
    const terminal = new TestTerminal();
    const run = runner(async () => ({ code: 0, stdout: 'installed', stderr: '' }));
    const runtime = new OpenCodeRuntime(terminal, run);
    expect(runtime.getInstallInstructions().command).toBe('npm install -g opencode-ai');
    await expect(runtime.install()).resolves.toEqual({ success: true, message: 'installed' });
    expect(run).toHaveBeenCalledWith(
      'npm',
      ['install', '-g', 'opencode-ai'],
      process.cwd(),
      300_000,
    );

    const session = await runtime.launch({
      workingDirectory: '/project',
      roleId: 'interactive',
      visible: true,
    });
    expect(terminal.calls).toHaveLength(1);
    expect(terminal.calls[0]).toMatchObject({
      cwd: '/project',
      command: 'powershell.exe',
      title: 'AI Development Team - OpenCode - Interactive',
    });
    const followerScript = Buffer.from(terminal.calls[0]?.args.at(-1) ?? '', 'base64').toString(
      'utf16le',
    );
    expect(followerScript).toContain('Waiting for controlled runtime output');
    expect(session).toMatchObject({ processId: 123, terminalOpened: true });
  });
});
