import { describe, expect, it, vi } from 'vitest';
import {
  buildOpenCodeRunArgs,
  OpenCodeRuntime,
  parseOpenCodeJsonEvents,
} from '../src/runtimes/opencode/runtime.js';
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
    expect(buildOpenCodeRunArgs({ prompt: 'Do the work' })).toEqual([
      'run',
      '--format',
      'json',
      'Do the work',
    ]);
    expect(
      buildOpenCodeRunArgs({
        prompt: 'Continue',
        resumeSessionId: 'ses_123',
        model: 'provider/model',
      }),
    ).toEqual([
      'run',
      '--format',
      'json',
      '--model',
      'provider/model',
      '--session',
      'ses_123',
      'Continue',
    ]);
  });

  it('discovers only models reported by the installed OpenCode CLI', async () => {
    const run = runner(async (_command, args) => ({
      code: 0,
      stdout: args[0] === 'models' ? 'anthropic/one\nopenai/two\nanthropic/one\n' : '',
      stderr: '',
    }));
    const runtime = new OpenCodeRuntime(new TestTerminal(), run);
    await expect(runtime.discoverModels('C:\\work')).resolves.toEqual({
      models: ['anthropic/one', 'openai/two'],
    });
    expect(run).toHaveBeenCalledWith('opencode', ['models'], 'C:\\work', 30_000);
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
      ['run', '--format', 'json', '--session', 'ses_abc', 'Second'],
      '.',
      undefined,
      expect.any(Function),
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
      ['run', '--format', 'json', 'Audit codewise'],
      '.',
      undefined,
      expect.any(Function),
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
