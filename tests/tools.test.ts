import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeTool } from '../src/tools/tool.js';
import { runCommandTool } from '../src/tools/command.js';
import { writeFileTool } from '../src/tools/files.js';

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

describe('tools', () => {
  it('validates arguments', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-team-'));
    directories.push(root);
    const result = await executeTool(
      writeFileTool,
      { path: 3 },
      { root, approve: async () => false },
    );
    expect(result.ok).toBe(false);
  });

  it('creates nested files with exact UTF-8 content', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-team-'));
    directories.push(root);
    const result = await executeTool(
      writeFileTool,
      { path: 'src/nested/result.txt', content: 'created by coder\n' },
      { root, approve: async () => false },
    );
    expect(result.ok).toBe(true);
    expect(await readFile(path.join(root, 'src/nested/result.txt'), 'utf8')).toBe(
      'created by coder\n',
    );
  });

  it('blocks dangerous commands', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-team-'));
    directories.push(root);
    const result = await executeTool(
      runCommandTool,
      { command: 'rm -rf .' },
      { root, approve: async () => true },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/blocked/);
  });

  it('runs safe commands with real output', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-team-'));
    directories.push(root);
    const result = await executeTool(
      runCommandTool,
      { command: 'node -e "console.log(42)"' },
      { root, approve: async () => false },
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain('42');
  });
});
