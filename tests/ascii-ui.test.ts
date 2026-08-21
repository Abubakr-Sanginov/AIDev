import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BANNER_LINES,
  estimateEtaMs,
  formatDuration,
  panel,
  progressBar,
  renderBanner,
  renderDashboard,
  resolveTheme,
  spinnerFrame,
  statusBadge,
} from '../src/ui/ascii.js';
import { loadConfig, resetConfig, setConfigValue } from '../src/config.js';
import { appendRunRecord, listRunRecords } from '../src/history.js';
import { buildReport } from '../src/report.js';
import type { RuntimeWorkflowState } from '../src/runtimes/runtime-orchestrator.js';

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

const mono = resolveTheme('mono');

function sampleState(overrides: Partial<RuntimeWorkflowState> = {}): RuntimeWorkflowState {
  return {
    goal: 'Build a TODO API',
    runtimeId: 'mock',
    status: 'DONE',
    attempts: 1,
    sessions: [],
    events: [
      {
        roleId: 'manager',
        status: 'DONE',
        message: 'plan ready',
        timestamp: '2026-08-21T10:00:00.000Z',
      },
      {
        roleId: 'tester',
        status: 'DONE',
        message: 'VERDICT: PASS',
        timestamp: '2026-08-21T10:01:00.000Z',
      },
    ],
    startedAt: '2026-08-21T10:00:00.000Z',
    updatedAt: '2026-08-21T10:02:05.000Z',
    completedPhases: 5,
    totalPhases: 5,
    ...overrides,
  };
}

describe('ascii ui', () => {
  it('renders the banner art with a subtitle and version', () => {
    const banner = renderBanner(mono, '0.2.0');
    expect(banner).toContain('█████');
    expect(banner).toContain('T E A M');
    expect(banner).toContain('0.2.0');
    expect(BANNER_LINES).toHaveLength(6);
  });

  it('renders a progress bar with percentage', () => {
    expect(progressBar(1, 2, 10)).toBe('[█████░░░░░] 50%');
    expect(progressBar(0, 0, 10)).toBe('[░░░░░░░░░░] 0%');
  });

  it('wraps lines in a titled panel with aligned borders', () => {
    const output = panel('Agents', ['Manager [ DONE ]', 'Tester  [ WAITING ]'], mono);
    const rows = output.split('\n');
    expect(rows[0]).toContain('Agents');
    expect(rows[0]?.startsWith('╭')).toBe(true);
    expect(rows.at(-1)?.startsWith('╰')).toBe(true);
    expect(new Set(rows.map((row) => row.length)).size).toBe(1);
  });

  it('formats durations and estimates ETA', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(65_000)).toBe('1m 5s');
    expect(formatDuration(3_700_000)).toBe('1h 1m');
    expect(estimateEtaMs(1, 3, 10_000)).toBe(20_000);
    expect(estimateEtaMs(0, 3, 10_000)).toBeUndefined();
  });

  it('keeps badges and spinner deterministic in mono theme', () => {
    expect(statusBadge('DONE', mono)).toBe('[ DONE ]');
    expect(spinnerFrame(0, 100)).toBe('⠋');
  });

  it('rejects unknown themes', () => {
    expect(() => resolveTheme('neon')).toThrow(/Unknown theme/);
  });

  it('renders the dashboard with overview, agents, and summary panels', () => {
    const output = renderDashboard(sampleState(), '/tmp/project', mono);
    expect(output).toContain('Overview');
    expect(output).toContain('Agents');
    expect(output).toContain('Run summary');
    expect(output).toContain('Build a TODO API');
  });
});

describe('config store', () => {
  it('round-trips persistent defaults and validates values', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'config-'));
    directories.push(root);
    expect(await loadConfig(root)).toEqual({});
    await setConfigValue(root, 'runtime', 'claude');
    await setConfigValue(root, 'theme', 'ocean');
    expect(await loadConfig(root)).toEqual({ runtime: 'claude', theme: 'ocean' });
    await expect(setConfigValue(root, 'approval', 'yolo')).rejects.toThrow(/approval/);
    await expect(setConfigValue(root, 'nope', 'x')).rejects.toThrow(/Unknown config key/);
    await resetConfig(root);
    expect(await loadConfig(root)).toEqual({});
  });
});

describe('run history', () => {
  it('appends and lists records newest-first', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'history-'));
    directories.push(root);
    expect(await listRunRecords(root)).toEqual([]);
    await appendRunRecord(root, {
      goal: 'one',
      runtimeId: 'mock',
      status: 'DONE',
      attempts: 0,
      finishedAt: '2026-08-21T10:00:00.000Z',
    });
    await appendRunRecord(root, {
      goal: 'two',
      runtimeId: 'mock',
      status: 'FAILED',
      attempts: 2,
      finishedAt: '2026-08-21T11:00:00.000Z',
    });
    const records = await listRunRecords(root);
    expect(records.map((record) => record.goal)).toEqual(['two', 'one']);
  });
});

describe('run report', () => {
  it('builds a markdown report with a phases table and duration', () => {
    const report = buildReport(sampleState());
    expect(report).toContain('# AI Dev Team — Run Report');
    expect(report).toContain('Build a TODO API');
    expect(report).toContain('| Manager | DONE | plan ready |');
    expect(report).toContain('Duration: 2m 5s');
  });
});
