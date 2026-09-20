import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { maskKey } from '../src/providers/mask.js';
import {
  addCustom,
  addPreset,
  getProvider,
  listProviders,
  providersView,
  removeProvider,
  resolveKey,
  setKey,
} from '../src/providers/store.js';
import { ApiProviderRuntime } from '../src/runtimes/api/runtime.js';

const directories: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'providers-'));
  directories.push(root);
  return root;
}
afterEach(async () => {
  delete process.env.MYCORP_API_KEY;
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('provider store', () => {
  it('adds a preset and reads it back from providers.json', async () => {
    const root = await tempRoot();
    await addPreset(root, 'openai', 'sk-test-1234567890abcdef');
    const provider = await getProvider(root, 'openai');
    expect(provider?.protocol).toBe('openai');
    expect(provider?.baseUrl).toBe('https://api.openai.com/v1');
    const raw = JSON.parse(
      await readFile(path.join(root, '.ai-dev-team', 'providers.json'), 'utf8'),
    ) as { providers: Record<string, unknown> };
    expect(Object.keys(raw.providers)).toContain('openai');
  });

  it('adds a custom provider with models and env binding', async () => {
    const root = await tempRoot();
    await addCustom(
      root,
      {
        id: 'mycorp',
        name: 'MyCorp LLM',
        protocol: 'openai',
        baseUrl: 'https://llm.mycorp.dev/v1',
        models: ['my-model-1', 'my-model-2'],
        apiKeyEnv: 'MYCORP_API_KEY',
      },
      'sk-mycorp-1234567890abcdef',
    );
    const ids = (await listProviders(root)).map((provider) => provider.id);
    expect(ids).toEqual(['mycorp']);
    expect((await resolveKey(root, 'mycorp'))).toEqual({
      ok: true,
      key: 'sk-mycorp-1234567890abcdef',
      source: 'stored',
    });
  });

  it('removes a provider together with its stored key', async () => {
    const root = await tempRoot();
    await addPreset(root, 'openai', 'sk-test-1234567890abcdef');
    await removeProvider(root, 'openai');
    expect(await getProvider(root, 'openai')).toBeUndefined();
    expect((await resolveKey(root, 'openai')).ok).toBe(false);
    await expect(removeProvider(root, 'openai')).rejects.toThrow("Unknown provider 'openai'");
  });

  it('rejects reserved and malformed ids', async () => {
    const root = await tempRoot();
    const base = {
      name: 'X',
      protocol: 'openai',
      baseUrl: 'https://x.dev/v1',
      models: ['m'],
    };
    await expect(addCustom(root, { ...base, id: 'claude' })).rejects.toThrow('reserved');
    await expect(addCustom(root, { ...base, id: 'mock' })).rejects.toThrow('reserved');
    await expect(addCustom(root, { ...base, id: 'Bad_ID' })).rejects.toThrow('Invalid provider id');
    await expect(addCustom(root, { ...base, id: 'a' })).rejects.toThrow('Invalid provider id');
    await expect(addCustom(root, { ...base, id: '1abc' })).rejects.toThrow('Invalid provider id');
  });

  it('prefers the environment variable over the stored key', async () => {
    const root = await tempRoot();
    await addCustom(
      root,
      {
        id: 'mycorp',
        name: 'MyCorp LLM',
        protocol: 'openai',
        baseUrl: 'https://llm.mycorp.dev/v1',
        models: ['m1'],
        apiKeyEnv: 'MYCORP_API_KEY',
      },
      'sk-stored-1234567890abcdef',
    );
    process.env.MYCORP_API_KEY = 'sk-env-1234567890abcdef';
    expect(await resolveKey(root, 'mycorp')).toEqual({
      ok: true,
      key: 'sk-env-1234567890abcdef',
      source: 'env',
    });
  });

  it('masks keys so the full key never appears in providersView output', async () => {
    const root = await tempRoot();
    const fullKey = 'sk-mycorp-1234567890abcdef';
    await addCustom(
      root,
      {
        id: 'mycorp',
        name: 'MyCorp LLM',
        protocol: 'openai',
        baseUrl: 'https://llm.mycorp.dev/v1',
        models: ['m1'],
      },
      fullKey,
    );
    const serialized = JSON.stringify(await providersView(root));
    expect(serialized).not.toContain(fullKey);
    expect(serialized).toContain('sk-…cdef');
    expect(maskKey('short')).toBe('••••');
    expect(maskKey('12345678')).toBe('••••');
    expect(maskKey('123456789')).toBe('123…6789');
  });

  it('reports a missing key as not ready in detect()', async () => {
    const root = await tempRoot();
    await addCustom(root, {
      id: 'mycorp',
      name: 'MyCorp LLM',
      protocol: 'openai',
      baseUrl: 'https://llm.mycorp.dev/v1',
      models: ['m1'],
      apiKeyEnv: 'MYCORP_API_KEY',
    });
    const provider = await getProvider(root, 'mycorp');
    expect(provider).toBeDefined();
    if (!provider) return;
    const runtime = new ApiProviderRuntime(provider, { root });
    const detection = await runtime.detect();
    expect(detection.installed).toBe(true);
    expect(detection.ready).toBe(false);
    expect(detection.authenticated).toBe('no');
    expect(detection.message).toContain('ai-dev-team providers set-key mycorp');
    expect(detection.message).toContain('MYCORP_API_KEY');
  });

  it('updates the stored key with setKey', async () => {
    const root = await tempRoot();
    await addPreset(root, 'openai');
    await setKey(root, 'openai', 'sk-new-1234567890abcdef');
    expect(await resolveKey(root, 'openai')).toEqual({
      ok: true,
      key: 'sk-new-1234567890abcdef',
      source: 'stored',
    });
    await expect(setKey(root, 'missing', 'sk-x')).rejects.toThrow("Unknown provider 'missing'");
  });
});
