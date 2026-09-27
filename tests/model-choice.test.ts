import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeCodeRuntime } from '../src/runtimes/claude-code/runtime.js';
import { CodexRuntime, parseCodexModelsCache } from '../src/runtimes/codex/runtime.js';
import { autoModelCandidates, modelChoiceLabel } from '../src/runtimes/model-selection.js';
import type {
  TerminalLauncher,
  TerminalOptions,
  TerminalProcess,
} from '../src/terminal/terminal.js';

class TestTerminal implements TerminalLauncher {
  async open(options: TerminalOptions): Promise<TerminalProcess> {
    return { command: options.command, processId: 42 };
  }
}

const directories: string[] = [];
afterEach(async () => {
  delete process.env.CODEX_HOME;
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const CACHE = JSON.stringify({
  fetched_at: '2026-09-24T00:00:00Z',
  models: [
    {
      slug: 'gpt-5.4',
      description: 'Strong model for everyday coding.',
      visibility: 'list',
      priority: 105,
    },
    { slug: 'gpt-5.5', description: 'Frontier model.', visibility: 'list', priority: 0 },
    { slug: 'internal-eval', description: 'Hidden.', visibility: 'hide', priority: 1 },
    { slug: 'gpt-5.4-mini', description: 'Small and fast.', visibility: 'list', priority: 4 },
    { slug: 'gpt-5.5', description: 'Duplicate entry.', visibility: 'list', priority: 50 },
  ],
});

describe('Codex model list', () => {
  it('lists visible models in Codex order without duplicates', () => {
    expect(parseCodexModelsCache(CACHE)).toEqual([
      { id: 'gpt-5.5', label: 'Frontier model.' },
      { id: 'gpt-5.4-mini', label: 'Small and fast.' },
      { id: 'gpt-5.4', label: 'Strong model for everyday coding.' },
    ]);
  });

  it('tolerates a missing or corrupt cache', () => {
    expect(parseCodexModelsCache('')).toEqual([]);
    expect(parseCodexModelsCache('{"models": "nope"}')).toEqual([]);
  });

  it('discovers models from CODEX_HOME and keeps manual ids allowed', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'codex-home-'));
    directories.push(home);
    await writeFile(path.join(home, 'models_cache.json'), CACHE);
    process.env.CODEX_HOME = home;
    const discovery = await new CodexRuntime(new TestTerminal()).discoverModels();
    expect(discovery.models).toEqual(['gpt-5.5', 'gpt-5.4-mini', 'gpt-5.4']);
    expect(discovery.allowCustom).toBe(true);
    expect(discovery.message).toBeUndefined();
  });

  it('explains an empty list instead of silently offering nothing', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'codex-home-'));
    directories.push(home);
    process.env.CODEX_HOME = home;
    const discovery = await new CodexRuntime(new TestTerminal()).discoverModels();
    expect(discovery.models).toEqual([]);
    expect(discovery.message).toMatch(/enter a model id manually/);
  });
});

describe('Claude Code model list', () => {
  it('offers the family aliases and accepts full model names', async () => {
    const discovery = await new ClaudeCodeRuntime(new TestTerminal()).discoverModels();
    expect(discovery.models).toEqual(['fable', 'opus', 'sonnet', 'haiku']);
    expect(discovery.allowCustom).toBe(true);
  });
});

describe('model chooser', () => {
  it('keeps Auto on the account default for CLI runtimes', () => {
    expect(autoModelCandidates({ models: ['fable', 'opus'], autoUsesDefault: true })).toEqual([]);
  });

  it('shows the label next to the id', () => {
    expect(
      modelChoiceLabel('opus', { models: ['opus'], labels: { opus: 'Opus: strong coding' } }),
    ).toBe('opus  — Opus: strong coding');
    expect(modelChoiceLabel('x', { models: ['x'], freeModels: ['x'] })).toBe('x  [free]');
  });
});
