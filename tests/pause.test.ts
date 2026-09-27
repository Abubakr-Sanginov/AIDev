import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PauseGate } from '../src/pause.js';
import {
  freezeProcesses,
  PausableTimer,
  thawProcesses,
  trackProcess,
} from '../src/runtimes/suspend.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('pause gate', () => {
  it('lets work through while running and holds it while paused', async () => {
    const gate = new PauseGate();
    await gate.wait();
    const phases: string[] = [];
    gate.onChange((phase) => phases.push(phase));
    gate.pause();
    expect(gate.phase).toBe('pausing');
    let released = false;
    const waiting = gate.wait().then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(gate.phase).toBe('paused');
    expect(released).toBe(false);
    gate.resume();
    await waiting;
    expect(released).toBe(true);
    expect(phases).toEqual(['pausing', 'paused', 'running']);
  });

  it('counts frozen agent processes as a completed pause', () => {
    const gate = new PauseGate();
    gate.markFrozen(true);
    expect(gate.phase).toBe('running');
    gate.pause();
    gate.markFrozen(true);
    expect(gate.phase).toBe('paused');
    gate.resume();
    expect(gate.phase).toBe('running');
  });
});

describe('pausable timer', () => {
  it('stops counting while paused and fires after the remaining time', () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    const timer = new PausableTimer(1_000, fired);
    vi.advanceTimersByTime(600);
    timer.pause();
    vi.advanceTimersByTime(10_000);
    expect(fired).not.toHaveBeenCalled();
    timer.resume();
    vi.advanceTimersByTime(399);
    expect(fired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fired).toHaveBeenCalledOnce();
  });

  it('never fires once cleared', () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    const timer = new PausableTimer(100, fired);
    timer.clear();
    timer.resume();
    vi.advanceTimersByTime(1_000);
    expect(fired).not.toHaveBeenCalled();
  });
});

describe('process freezing', () => {
  it('freezes a whole process tree and thaws it again', async () => {
    // A shell wrapper around a grandchild, like the cmd.exe shims around agent CLIs.
    const child = spawn('node -e "setInterval(() => console.log(1), 50)"', {
      shell: true,
      windowsHide: true,
    });
    const untrack = trackProcess(child);
    let ticks = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      ticks += chunk.toString('utf8').trim().split('\n').length;
    });
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    try {
      await sleep(1_000);
      expect(ticks).toBeGreaterThan(0);
      expect(await freezeProcesses()).toBe(1);
      // Let output already in the pipe drain before counting.
      await sleep(300);
      const atFreeze = ticks;
      await sleep(1_000);
      expect(ticks - atFreeze).toBe(0);
      await thawProcesses();
      const atThaw = ticks;
      await sleep(1_000);
      expect(ticks - atThaw).toBeGreaterThan(0);
    } finally {
      await thawProcesses();
      untrack();
      if (process.platform === 'win32' && child.pid !== undefined)
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
      else child.kill('SIGKILL');
    }
  }, 30_000);
});
