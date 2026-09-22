import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addCustom, getProvider } from '../src/providers/store.js';
import { ApiProviderRuntime } from '../src/runtimes/api/runtime.js';
import { isFatalDiagnostic, isProviderDiagnostic } from '../src/runtimes/failure-policy.js';
import { MUTATING_TOOL_NAMES, selectTools } from '../src/runtimes/api/tools.js';
import { allTools } from '../src/tools/index.js';
import type { StoredProvider } from '../src/providers/store.js';

const directories: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'api-runtime-'));
  directories.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

type FetchCall = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

function fakeFetch(
  responses: { status?: number; payload: unknown }[],
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error('Unexpected extra fetch call.');
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const rawBody = init?.body;
    calls.push({
      url,
      body: JSON.parse(typeof rawBody === 'string' ? rawBody : '{}') as Record<string, unknown>,
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      ),
    });
    return new Response(JSON.stringify(next.payload), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

async function setupProvider(
  root: string,
  protocol: 'openai' | 'anthropic',
): Promise<StoredProvider> {
  await addCustom(
    root,
    {
      id: 'testprov',
      name: 'Test Provider',
      protocol,
      baseUrl: protocol === 'openai' ? 'https://llm.test/v1' : 'https://api.test',
      models: ['test-model'],
    },
    'sk-test-1234567890abcdef',
  );
  const stored = await getProvider(root, 'testprov');
  if (!stored) throw new Error('provider not stored');
  return stored;
}

describe('ApiProviderRuntime — OpenAI protocol', () => {
  it('runs one tool call then returns the final text', async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, 'note.txt'), 'hello world', 'utf8');
    const stored = await setupProvider(root, 'openai');
    const { fetchImpl, calls } = fakeFetch([
      {
        payload: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'read_file', arguments: '{"path":"note.txt"}' },
                  },
                ],
              },
            },
          ],
        },
      },
      { payload: { choices: [{ message: { role: 'assistant', content: 'The note says hello.' } }] } },
    ]);
    const runtime = new ApiProviderRuntime(stored, { root, fetchImpl });
    const session = await runtime.launch({ workingDirectory: root, roleId: 'coder' });
    const activities: string[] = [];
    const result = await runtime.execute(session, {
      prompt: 'Read note.txt and summarize it.',
      onActivity: (activity) => {
        activities.push(activity.message);
      },
    });
    expect(result.success).toBe(true);
    expect(result.output).toBe('The note says hello.');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('https://llm.test/v1/chat/completions');
    expect(calls[0]?.headers.authorization).toBe('Bearer sk-test-1234567890abcdef');
    const secondMessages = calls[1]?.body.messages as Record<string, unknown>[];
    const toolMessage = secondMessages.find((message) => message.role === 'tool');
    expect(toolMessage?.tool_call_id).toBe('call_1');
    expect(toolMessage?.content).toBe('hello world');
    expect(activities.some((message) => message.includes('read_file'))).toBe(true);
  });

  it('throws an HTTP error that isFatalDiagnostic classifies as fatal', async () => {
    const root = await tempRoot();
    const stored = await setupProvider(root, 'openai');
    const { fetchImpl } = fakeFetch([
      { status: 402, payload: { error: { message: 'insufficient quota' } } },
    ]);
    const runtime = new ApiProviderRuntime(stored, { root, fetchImpl });
    const session = await runtime.launch({ workingDirectory: root, roleId: 'coder' });
    const error = await runtime.execute(session, { prompt: 'hi' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('HTTP 402');
    expect(isFatalDiagnostic(message)).toBe(true);
    expect(session.status).toBe('failed');
  });
});

describe('ApiProviderRuntime — Anthropic protocol', () => {
  it('runs one tool call then returns the final text', async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, 'note.txt'), 'anthropic note', 'utf8');
    const stored = await setupProvider(root, 'anthropic');
    const { fetchImpl, calls } = fakeFetch([
      {
        payload: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'note.txt' } },
          ],
        },
      },
      { payload: { role: 'assistant', content: [{ type: 'text', text: 'Done reading.' }] } },
    ]);
    const runtime = new ApiProviderRuntime(stored, { root, fetchImpl });
    const session = await runtime.launch({ workingDirectory: root, roleId: 'coder' });
    const result = await runtime.execute(session, { prompt: 'Read note.txt.' });
    expect(result.success).toBe(true);
    expect(result.output).toBe('Done reading.');
    expect(calls[0]?.url).toBe('https://api.test/v1/messages');
    expect(calls[0]?.headers['x-api-key']).toBe('sk-test-1234567890abcdef');
    expect(calls[0]?.headers['anthropic-version']).toBe('2023-06-01');
    const secondMessages = calls[1]?.body.messages as Record<string, unknown>[];
    const last = secondMessages.at(-1);
    expect(last?.role).toBe('user');
    const blocks = last?.content as Record<string, unknown>[];
    expect(blocks[0]?.type).toBe('tool_result');
    expect(blocks[0]?.tool_use_id).toBe('toolu_1');
    expect(blocks[0]?.content).toBe('anthropic note');
  });
});
describe('ApiProviderRuntime — tool policy and budgets', () => {
  it('strips mutating tools from the read-only schema list', () => {
    const names = selectTools(allTools, 'read-only').map((tool) => tool.definition.name);
    for (const mutating of MUTATING_TOOL_NAMES) expect(names).not.toContain(mutating);
    expect(names).toContain('read_file');
    expect(names).toContain('list_files');
    expect(names).toContain('search_files');
  });

  it('rejects a mutating tool call under read-only policy', async () => {
    const root = await tempRoot();
    const stored = await setupProvider(root, 'openai');
    const { fetchImpl, calls } = fakeFetch([
      {
        payload: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_9',
                    type: 'function',
                    function: {
                      name: 'write_file',
                      arguments: '{"path":"evil.txt","content":"x"}',
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      { payload: { choices: [{ message: { role: 'assistant', content: 'Aborted.' } }] } },
    ]);
    const runtime = new ApiProviderRuntime(stored, { root, fetchImpl });
    const session = await runtime.launch({ workingDirectory: root, roleId: 'reviewer' });
    const result = await runtime.execute(session, {
      prompt: 'Audit the project.',
      toolPolicy: 'read-only',
    });
    expect(result.success).toBe(true);
    const firstTools = calls[0]?.body.tools as Record<string, unknown>[];
    const offered = firstTools.map((tool) => (tool.function as Record<string, unknown>).name);
    for (const mutating of MUTATING_TOOL_NAMES) expect(offered).not.toContain(mutating);
    const secondMessages = calls[1]?.body.messages as Record<string, unknown>[];
    const toolMessage = secondMessages.find((message) => message.role === 'tool');
    expect(String(toolMessage?.content)).toContain('not allowed in read-only mode');
  });

  it('warns at the soft tool-call budget instead of failing', async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, 'note.txt'), 'data', 'utf8');
    const stored = await setupProvider(root, 'openai');
    const toolCallReply = (id: string) => ({
      payload: {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id,
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"path":"note.txt"}' },
                },
              ],
            },
          },
        ],
      },
    });
    const { fetchImpl, calls } = fakeFetch([
      toolCallReply('c1'),
      toolCallReply('c2'),
      { payload: { choices: [{ message: { role: 'assistant', content: 'Wrapped up.' } }] } },
    ]);
    const runtime = new ApiProviderRuntime(stored, { root, fetchImpl });
    const session = await runtime.launch({ workingDirectory: root, roleId: 'coder' });
    const result = await runtime.execute(session, {
      prompt: 'loop',
      maxToolCalls: 1,
      maxSteps: 10,
    });
    expect(result.success).toBe(true);
    expect(result.output).toBe('Wrapped up.');
    expect(calls).toHaveLength(3);
    // After crossing the soft budget the model receives a wrap-up warning
    // instead of a hard failure.
    const lastMessages = calls[2]?.body.messages as Record<string, unknown>[];
    expect(
      lastMessages.some(
        (message) => message.role === 'user' && String(message.content).includes('Budget warning'),
      ),
    ).toBe(true);
  });

  it('replays identical tool calls from cache instead of re-executing them', async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, 'note.txt'), 'data', 'utf8');
    const stored = await setupProvider(root, 'openai');
    const { fetchImpl, calls } = fakeFetch([
      {
        payload: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'c1',
                    type: 'function',
                    function: { name: 'read_file', arguments: '{"path":"note.txt"}' },
                  },
                  {
                    id: 'c2',
                    type: 'function',
                    function: { name: 'read_file', arguments: '{"path":"note.txt"}' },
                  },
                ],
              },
            },
          ],
        },
      },
      { payload: { choices: [{ message: { role: 'assistant', content: 'Done.' } }] } },
    ]);
    const runtime = new ApiProviderRuntime(stored, { root, fetchImpl });
    const session = await runtime.launch({ workingDirectory: root, roleId: 'coder' });
    const result = await runtime.execute(session, { prompt: 'read twice' });
    expect(result.success).toBe(true);
    const messages = calls[1]?.body.messages as Record<string, unknown>[];
    const toolMessages = messages.filter((message) => message.role === 'tool');
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages[0]?.content).toBe('data');
    expect(toolMessages[1]?.content).toBe('data');
  });

  it('sends no tool schemas when the role has a zero tool budget', async () => {
    const root = await tempRoot();
    const stored = await setupProvider(root, 'openai');
    const { fetchImpl, calls } = fakeFetch([
      { payload: { choices: [{ message: { role: 'assistant', content: 'Plan only.' } }] } },
    ]);
    const runtime = new ApiProviderRuntime(stored, { root, fetchImpl });
    const session = await runtime.launch({ workingDirectory: root, roleId: 'manager' });
    const result = await runtime.execute(session, {
      prompt: 'Plan the project.',
      maxToolCalls: 0,
    });
    expect(result.success).toBe(true);
    expect(result.output).toBe('Plan only.');
    expect(calls[0]?.body.tools).toBeUndefined();
  });

  it('retries transient network failures inside one stage', async () => {
    const root = await tempRoot();
    const stored = await setupProvider(root, 'openai');
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls <= 2) {
        const error = new TypeError('fetch failed');
        (error as { cause?: unknown }).cause = new Error('socket hang up');
        throw error;
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Recovered.' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    const runtime = new ApiProviderRuntime(stored, {
      root,
      fetchImpl,
      transportDelaysMs: [1, 1],
    });
    const session = await runtime.launch({ workingDirectory: root, roleId: 'coder' });
    const result = await runtime.execute(session, { prompt: 'hi' });
    expect(result.success).toBe(true);
    expect(result.output).toBe('Recovered.');
    expect(calls).toBe(3);
  });

  it('surfaces the wrapped network cause when the transport stays down', async () => {
    const root = await tempRoot();
    const stored = await setupProvider(root, 'openai');
    const fetchImpl = (async () => {
      const error = new TypeError('fetch failed');
      (error as { cause?: unknown }).cause = new Error('connect ETIMEDOUT 1.2.3.4:443');
      throw error;
    }) as typeof fetch;
    const runtime = new ApiProviderRuntime(stored, {
      root,
      fetchImpl,
      transportDelaysMs: [1, 1],
    });
    const session = await runtime.launch({ workingDirectory: root, roleId: 'coder' });
    const error = await runtime.execute(session, { prompt: 'hi' }).catch((e: unknown) => e);
    const message = (error as Error).message;
    expect(message).toContain('Network error: fetch failed');
    expect(message).toContain('connect ETIMEDOUT');
    expect(isProviderDiagnostic(message)).toBe(true);
  });

  it('fails the stage when the provider accepts the request but never answers', async () => {
    const root = await tempRoot();
    const stored = await setupProvider(root, 'openai');
    let calls = 0;
    const fetchImpl = ((_url: string, init?: { signal?: AbortSignal }) => {
      calls += 1;
      // A silent socket: only the abort signal ever settles this request.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const reason: unknown = init.signal?.reason;
          reject(reason instanceof Error ? reason : new Error('aborted'));
        });
      });
    }) as unknown as typeof fetch;
    const runtime = new ApiProviderRuntime(stored, {
      root,
      fetchImpl,
      transportDelaysMs: [1, 1],
      requestTimeoutMs: 20,
    });
    const session = await runtime.launch({ workingDirectory: root, roleId: 'coder' });
    const error = await runtime.execute(session, { prompt: 'hi' }).catch((e: unknown) => e);
    const message = (error as Error).message;
    expect(message).toContain('did not respond within 20ms');
    // The budget was already spent, so the transport must not retry in place.
    expect(calls).toBe(1);
  });
});

