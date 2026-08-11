import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Orchestrator } from '../src/orchestrator.js';
import { MockProvider } from '../src/providers/mock.js';
import type { ProjectState } from '../src/types.js';
import type { UI } from '../src/ui.js';

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);
const ui: UI = { render(_state: ProjectState, _activity: string[]) {}, log(_line: string) {} };

describe('Orchestrator', () => {
  it('hands work across specialized agents and persists state', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-team-'));
    directories.push(root);
    const provider = new MockProvider([
      { content: 'Plan: create app.txt and verify it.', toolCalls: [] },
      {
        content: '',
        toolCalls: [
          {
            id: 'a',
            name: 'write_file',
            arguments: {
              path: '.ai-team/architecture.md',
              content: '# Architecture\nSimple file.',
            },
          },
        ],
      },
      { content: 'Architecture complete.', toolCalls: [] },
      {
        content: '',
        toolCalls: [
          { id: 'b', name: 'write_file', arguments: { path: 'app.txt', content: 'working' } },
        ],
      },
      { content: 'Implementation complete.', toolCalls: [] },
      { content: 'VERDICT: PASS', toolCalls: [] },
      { content: 'VERDICT: PASS', toolCalls: [] },
    ]);
    const state = await new Orchestrator({ root, provider, ui, approve: async () => true }).run(
      'Create a file app',
    );
    expect(state.status).toBe('DONE');
    expect(await readFile(path.join(root, 'app.txt'), 'utf8')).toBe('working');
    const saved = JSON.parse(
      await readFile(path.join(root, '.ai-team/state.json'), 'utf8'),
    ) as ProjectState;
    expect(saved.tasks.every((task) => task.status === 'DONE' || task.role === 'Fixer')).toBe(true);
  });
});
