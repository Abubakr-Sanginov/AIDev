import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SharedLoopAgent } from '../src/agents/agent.js';
import { MockProvider } from '../src/providers/mock.js';
import { allTools } from '../src/tools/index.js';

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

describe('SharedLoopAgent', () => {
  it('executes a real tool call and returns the result to the provider', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-team-'));
    directories.push(root);
    const provider = new MockProvider([
      {
        content: '',
        toolCalls: [
          {
            id: '1',
            name: 'write_file',
            arguments: { path: 'result.txt', content: 'real output' },
          },
        ],
      },
      (messages) => ({
        content: messages.some(
          (message) => message.role === 'tool' && message.content.includes('Wrote'),
        )
          ? 'done'
          : 'missing',
        toolCalls: [],
      }),
    ]);
    const agent = new SharedLoopAgent({
      role: 'Coder',
      systemPrompt: 'test',
      provider,
      tools: allTools,
    });
    const result = await agent.run('write a file', { root, approve: async () => false });
    expect(result.output).toBe('done');
    expect(await readFile(path.join(root, 'result.txt'), 'utf8')).toBe('real output');
    expect(provider.calls).toBe(2);
  });
});
