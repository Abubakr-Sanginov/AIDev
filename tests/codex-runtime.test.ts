import { describe, expect, it, vi } from 'vitest';
import {
  buildCodexExecArgs,
  CodexRuntime,
  parseCodexJsonEvents,
} from '../src/runtimes/codex/runtime.js';
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
    return { command: options.command, processId: 42 };
  }
}

it('builds Codex JSON execution and exact resume arguments', () => {
  expect(buildCodexExecArgs({ prompt: 'work' })).toEqual([
    'exec',
    '--json',
    '--color',
    'never',
    '--sandbox',
    'workspace-write',
    'work',
  ]);
  expect(buildCodexExecArgs({ prompt: 'continue', resumeSessionId: 'thread-1' })).toEqual([
    'exec',
    'resume',
    '--json',
    '--color',
    'never',
    'thread-1',
    'continue',
  ]);
  expect(buildCodexExecArgs({ prompt: 'audit', toolPolicy: 'read-only' })).toEqual([
    'exec',
    '--json',
    '--color',
    'never',
    '--sandbox',
    'read-only',
    'audit',
  ]);
});

it('parses Codex JSONL output and thread ID', () => {
  expect(
    parseCodexJsonEvents(
      [
        JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
        JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } }),
      ].join('\n'),
    ),
  ).toEqual({ output: 'done', sessionId: 'thread-1' });
});

describe('CodexRuntime', () => {
  it('opens a follower terminal for the actual controlled process output', async () => {
    const terminal = new TestTerminal();
    const run = vi.fn<ProcessRunner>(async () => ({
      code: 0,
      stdout: 'codex-cli 1.0.0',
      stderr: '',
    }));
    const runtime = new CodexRuntime(terminal, run);
    const session = await runtime.launch({
      workingDirectory: process.cwd(),
      roleId: 'coder',
      visible: true,
    });
    expect(terminal.calls[0]).toMatchObject({
      command: 'powershell.exe',
      title: 'AI Development Team - Codex CLI - Coder',
    });
    const followerScript = Buffer.from(terminal.calls[0]?.args.at(-1) ?? '', 'base64').toString(
      'utf16le',
    );
    expect(followerScript).toContain('Waiting for controlled runtime output');
    expect(session.outputFile).toContain('coder.log');
  });
});
