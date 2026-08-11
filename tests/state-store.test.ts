import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { StateStore } from '../src/state-store.js';

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);
it('persists runtime workflow state under .ai-dev-team', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'state-'));
  directories.push(root);
  const store = new StateStore(root);
  const state = {
    goal: 'goal',
    runtimeId: 'mock',
    status: 'DONE' as const,
    attempts: 0,
    sessions: [],
    events: [],
  };
  await store.save(state);
  expect(await store.load()).toEqual(state);
});

it('handles concurrent saves without sharing a temporary file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'state-concurrent-'));
  directories.push(root);
  const store = new StateStore(root);
  const states = Array.from({ length: 20 }, (_, attempts) => ({
    goal: `concurrent goal ${attempts}`,
    runtimeId: 'mock',
    status: 'RUNNING' as const,
    attempts,
    sessions: [],
    events: [],
  }));

  await Promise.all(states.map((state) => store.save(state)));

  expect(states).toContainEqual(await store.load());
  expect((await readdir(store.directory)).filter((file) => file.endsWith('.tmp'))).toEqual([]);
});

it('retries transient EPERM during replacement', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'state-eperm-'));
  directories.push(root);
  const oldState = {
    goal: 'old',
    runtimeId: 'mock',
    status: 'RUNNING' as const,
    attempts: 0,
    sessions: [],
    events: [],
  };
  await new StateStore(root).save(oldState);
  let failures = 2;
  const store = new StateStore(root, {
    retryDelays: [0, 0],
    sleep: async () => undefined,
    fs: {
      rename: async (source, destination) => {
        if (source.toString().endsWith('.tmp')) {
          if (destination.toString().endsWith('state.json')) {
            if (failures-- > 0) throw Object.assign(new Error('locked'), { code: 'EPERM' });
          }
        }
        await import('node:fs/promises').then((fs) => fs.rename(source, destination));
      },
    },
  });
  const next = { ...oldState, goal: 'new' };
  await store.save(next);
  expect(await store.load()).toEqual(next);
});

it('rolls back valid state after exhausted replacement retries', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'state-rollback-'));
  directories.push(root);
  const oldState = {
    goal: 'old',
    runtimeId: 'mock',
    status: 'RUNNING' as const,
    attempts: 0,
    sessions: [],
    events: [],
  };
  const original = new StateStore(root);
  await original.save(oldState);
  const store = new StateStore(root, {
    retryDelays: [0],
    sleep: async () => undefined,
    fs: {
      rename: async (source, destination) => {
        if (source.toString().endsWith('.tmp')) {
          if (destination.toString().endsWith('state.json'))
            throw Object.assign(new Error('locked'), { code: 'EPERM' });
        }
        await import('node:fs/promises').then((fs) => fs.rename(source, destination));
      },
    },
  });
  await expect(store.save({ ...oldState, goal: 'new' })).rejects.toThrow(
    /previous state was restored/,
  );
  expect(await original.load()).toEqual(oldState);
});

it('never exposes partial JSON to concurrent readers during repeated replacements', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'state-readers-'));
  directories.push(root);
  const store = new StateStore(root);
  const initial = {
    goal: 'initial',
    runtimeId: 'mock',
    status: 'RUNNING' as const,
    attempts: 0,
    sessions: [],
    events: [],
  };
  await store.save(initial);
  const control: { writing: boolean } = { writing: true };
  const reads: Promise<void>[] = [];
  for (let reader = 0; reader < 2; reader++) {
    reads.push(
      (async () => {
        const runtimeStore = new StateStore(root);
        while (control.writing) {
          const state = await runtimeStore.load();
          if (state) expect(state.goal).toMatch(/^(initial|generation \d+)$/);
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      })(),
    );
  }

  try {
    for (let attempts = 1; attempts <= 20; attempts++) {
      await store.save({ ...initial, goal: `generation ${attempts}`, attempts });
    }
  } finally {
    control.writing = false;
    await Promise.all(reads);
  }
  expect((await new StateStore(root).load())?.goal).toBe('generation 20');
  expect(
    (await readdir(store.directory)).filter(
      (file) => file.endsWith('.tmp') || file.endsWith('.bak'),
    ),
  ).toEqual([]);
}, 15_000);
