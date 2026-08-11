import { describe, expect, it, vi } from 'vitest';
import { ClaudeCodeRuntime } from '../src/runtimes/claude-code/runtime.js';
import type { ProcessRunner } from '../src/runtimes/process.js';
import type {
  TerminalLauncher,
  TerminalOptions,
  TerminalProcess,
} from '../src/terminal/terminal.js';

class TestTerminal implements TerminalLauncher {
  async open(options: TerminalOptions): Promise<TerminalProcess> {
    return { command: options.command };
  }
}

function runner(
  implementation: ProcessRunner,
): ProcessRunner & ReturnType<typeof vi.fn<ProcessRunner>> {
  return vi.fn(implementation);
}

describe('ClaudeCodeRuntime', () => {
  it('detects Claude Code and reports its version through the process abstraction', async () => {
    const run = runner(async (_command, args) => ({
      code: 0,
      stdout: args[0] === '--version' ? '2.1.185 (Claude Code)\n' : '{"loggedIn":true}',
      stderr: '',
    }));
    const runtime = new ClaudeCodeRuntime(new TestTerminal(), run);

    await expect(runtime.detect()).resolves.toEqual({
      installed: true,
      ready: true,
      authenticated: 'yes',
      version: '2.1.185 (Claude Code)',
    });
    expect(run).toHaveBeenNthCalledWith(1, 'claude', ['--version'], process.cwd(), 10_000);
    expect(run).toHaveBeenNthCalledWith(
      2,
      'claude',
      ['auth', 'status', '--json'],
      process.cwd(),
      10_000,
    );
  });

  it('accepts version output written to stderr', async () => {
    const run = runner(async () => ({ code: 0, stdout: '', stderr: '2.1.185 (Claude Code)\n' }));
    await expect(new ClaudeCodeRuntime(new TestTerminal(), run).detect()).resolves.toMatchObject({
      installed: true,
      ready: true,
      version: '2.1.185 (Claude Code)',
    });
  });

  it('reports a missing command when the process abstraction rejects', async () => {
    const run = runner(async () => {
      throw new Error('ENOENT');
    });
    await expect(new ClaudeCodeRuntime(new TestTerminal(), run).detect()).resolves.toMatchObject({
      installed: false,
      ready: false,
      message: 'Claude Code command was not found.',
    });
  });

  it('passes prompts as an argument without shell interpretation', async () => {
    const run = runner(async () => ({
      code: 0,
      stdout: JSON.stringify({ result: 'done', session_id: 'session-1' }),
      stderr: '',
    }));
    const runtime = new ClaudeCodeRuntime(new TestTerminal(), run);
    const session = await runtime.launch({ workingDirectory: 'C:\\work', roleId: 'coder' });
    const prompt = 'Use & echo %PATH% | remove $(nothing)';

    await runtime.execute(session, { prompt });

    expect(run).toHaveBeenCalledWith(
      'claude',
      ['-p', prompt, '--output-format', 'json'],
      'C:\\work',
      undefined,
      expect.any(Function),
    );
  });

  it('denies mutating tools when running under a read-only policy', async () => {
    const run = runner(async () => ({
      code: 0,
      stdout: JSON.stringify({ result: 'done', session_id: 'session-1' }),
      stderr: '',
    }));
    const runtime = new ClaudeCodeRuntime(new TestTerminal(), run);
    const session = await runtime.launch({ workingDirectory: 'C:\\work', roleId: 'coder' });

    await runtime.execute(session, { prompt: 'audit', toolPolicy: 'read-only' });

    expect(run).toHaveBeenCalledWith(
      'claude',
      [
        '-p',
        'audit',
        '--output-format',
        'json',
        '--disallowedTools',
        'Bash, Edit, Write, MultiEdit, NotebookEdit',
      ],
      'C:\\work',
      undefined,
      expect.any(Function),
    );
  });
});
