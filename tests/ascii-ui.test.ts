import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BANNER_LINES,
  estimateEtaMs,
  formatDuration,
  hitTest,
  panel,
  progressBar,
  renderBanner,
  renderDashboard,
  resolveTheme,
  spinnerFrame,
  statusBadge,
  truncateVisible,
  type Rect,
} from '../src/ui/ascii.js';
import {
  renderActivityView,
  renderAgentView,
  renderGoalView,
  renderHelpView,
  wrapText,
} from '../src/ui/inspect.js';
import {
  INITIAL_UI_STATE,
  parseTerminalInput,
  reduceUiEvent,
} from '../src/ui/interactive.js';
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

describe('interactive ui', () => {
  it('parses SGR mouse reports and control keys from a raw stdin chunk', () => {
    const events = parseTerminalInput('\x1B[<0;12;9M\x1B[<64;5;3Mq\x1B[B\x1B[5~');
    expect(events).toEqual([
      { type: 'mouse', button: 'left', x: 12, y: 9 },
      { type: 'mouse', button: 'wheel-up', x: 5, y: 3 },
      { type: 'key', key: 'q' },
      { type: 'key', key: 'arrow-down' },
      { type: 'key', key: 'page-up' },
    ]);
  });

  it('opens views from dashboard hotspots and closes them with Esc or a click', () => {
    const hotspots: Rect[] = [
      { id: 'overview', top: 1, left: 1, bottom: 8, right: 60 },
      { id: 'agent:coder', top: 12, left: 2, bottom: 12, right: 30 },
    ];
    const openedGoal = reduceUiEvent(
      { ...INITIAL_UI_STATE, hotspots },
      { type: 'mouse', button: 'left', x: 5, y: 3 },
      10,
    );
    expect(openedGoal.view).toEqual({ kind: 'goal' });
    const openedAgent = reduceUiEvent(
      { ...INITIAL_UI_STATE, hotspots },
      { type: 'mouse', button: 'left', x: 10, y: 12 },
      10,
    );
    expect(openedAgent.view).toEqual({ kind: 'agent', roleId: 'coder' });
    const closed = reduceUiEvent(openedGoal, { type: 'key', key: 'escape' }, 10);
    expect(closed.view).toEqual({ kind: 'dashboard' });
    const closedByClick = reduceUiEvent(
      openedAgent,
      { type: 'mouse', button: 'left', x: 2, y: 2 },
      10,
    );
    expect(closedByClick.view).toEqual({ kind: 'dashboard' });
  });

  it('opens the activity view with the a key and scrolls overlays', () => {
    const opened = reduceUiEvent(INITIAL_UI_STATE, { type: 'key', key: 'a' }, 10);
    expect(opened.view).toEqual({ kind: 'activity' });
    const scrolled = reduceUiEvent(opened, { type: 'key', key: 'page-up' }, 10);
    expect(scrolled.scroll).toBe(10);
    const clamped = reduceUiEvent(scrolled, { type: 'mouse', button: 'wheel-down', x: 1, y: 1 }, 10);
    expect(clamped.scroll).toBe(7);
    const digit = reduceUiEvent(INITIAL_UI_STATE, { type: 'key', key: '2' }, 10);
    expect(digit.view).toEqual({ kind: 'agent', roleId: 'architect' });
  });

  it('wraps long unspaced tokens without losing characters', () => {
    const wrapped = wrapText('x'.repeat(25) + ' tail', 10);
    expect(wrapped).toEqual(['x'.repeat(10), 'x'.repeat(10), 'xxxxx tail']);
  });

  it('renders the goal view with the full request and per-role statuses', () => {
    const state = sampleState({
      goal: 'A very long goal '.repeat(20).trim(),
      status: 'RUNNING',
    });
    const view = renderGoalView(state, mono, { width: 80, height: 20 }, 0);
    expect(view.lines).toHaveLength(20);
    const goalLines = view.lines.filter((line) => line.includes('A very long goal'));
    expect(goalLines.length).toBeGreaterThan(1); // wrapped, not truncated
    expect(view.lines.some((line) => line.includes('Per-role last message'))).toBe(true);
  });

  it('renders the full activity history with timestamps and indices', () => {
    const state = sampleState();
    const view = renderActivityView(state, mono, { width: 80, height: 10 }, 0);
    expect(view.total).toBe(2);
    const text = view.lines.join('\n');
    expect(text).toContain('#001');
    expect(text).toContain('manager');
    expect(text).toContain('VERDICT: PASS');
  });

  it('wraps a long first line of an event instead of truncating it', () => {
    const long = `Provider failure after 3 attempts: fetch failed. Backend unavailable; continue conservatively and report the gap for the next stage.`;
    const state = sampleState({
      events: [
        {
          roleId: 'backend',
          status: 'FAILED',
          message: long,
          timestamp: '2026-08-21T10:00:00.000Z',
        },
      ],
    });
    const view = renderActivityView(state, mono, { width: 80, height: 12 }, 0);
    const text = view.lines.join('\n');
    expect(view.total).toBeGreaterThan(1);
    expect(text).toContain('#001');
    expect(text).toContain('Backend');
    for (const word of long.split('.').flatMap((part) => part.split(' ')))
      if (word.length >= 4) expect(text.replaceAll('\n', ' ')).toContain(word);
  });

  it('renders the agent view with budget, events, and sessions', () => {
    const state = sampleState({
      sessions: [
        {
          id: 'session-123456',
          runtimeId: 'mock',
          roleId: 'tester',
          workingDirectory: '.',
          status: 'completed',
          createdAt: '2026-08-21T10:00:30.000Z',
        },
      ],
    });
    const view = renderAgentView(state, 'tester', mono, { width: 80, height: 20 }, 0);
    const text = view.lines.join('\n');
    expect(text).toContain('Tester — details');
    expect(text).toContain('read-only');
    expect(text).toContain('session-');
    expect(text).toContain('VERDICT: PASS');
  });

  it('renders the help view with click and key references', () => {
    const view = renderHelpView(mono, { width: 80, height: 20 });
    const text = view.lines.join('\n');
    expect(text).toContain('Mouse');
    expect(text).toContain('click Overview');
    expect(text).toContain('Esc');
  });

  it('collects dashboard hotspots for the panels and every agent row', () => {
    const hotspots: Rect[] = [];
    renderDashboard(sampleState(), '/tmp/project', mono, { hotspots, offsetY: 7 });
    const ids = hotspots.map((rect) => rect.id);
    expect(ids).toContain('overview');
    expect(ids).toContain('activity');
    expect(ids).toContain('agents');
    expect(ids).toContain('agent:manager');
    expect(ids).toContain('agent:reviewer');
    const manager = hotspots.find((rect) => rect.id === 'agent:manager');
    expect(manager?.top).toBe(18); // banner (7) + overview panel (9) + border (1) + row (1)
    expect(hitTest(hotspots, 5, 18)).toBe('agent:manager');
    expect(hitTest(hotspots, 5, 9)).toBe('overview');
  });
});

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

  it('clamps panels to the terminal width without breaking ANSI sequences', () => {
    const output = panel('Activity', [`Retry:  ${'x'.repeat(200)}`], mono, 60);
    for (const row of output.split('\n')) expect(row.length).toBeLessThanOrEqual(60);
    expect(truncateVisible('abcdef', 3)).toBe('abc');
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

  it('lists recent activity rows with role, status, and message detail', () => {
    const state = sampleState({
      status: 'RUNNING',
      events: [
        {
          roleId: 'coder',
          status: 'RUNNING',
          message: 'Coder attempt 1/3 started.',
          timestamp: '2026-08-21T10:00:00.000Z',
        },
        {
          roleId: 'coder',
          status: 'ACTIVE',
          message: 'bash: npm test',
          timestamp: '2026-08-21T10:00:05.000Z',
        },
        {
          roleId: 'coder',
          status: 'ACTIVE',
          message: 'bash result: all tests passed',
          timestamp: '2026-08-21T10:00:07.000Z',
        },
        {
          roleId: 'tester',
          status: 'DONE',
          message: 'VERDICT: PASS',
          timestamp: '2026-08-21T10:01:00.000Z',
        },
      ],
    });
    const output = renderDashboard(state, '/tmp/project', mono, { maxWidth: 96 });
    expect(output).toContain('bash: npm test');
    expect(output).toContain('bash result: all tests passed');
    expect(output).toContain('Coder attempt 1/3 started.');
    // Low-value events stay hidden unless verbose mode is on.
    const noisy = renderDashboard(
      sampleState({
        events: [
          { roleId: 'coder', status: 'ACTIVE', message: 'OpenCode event: tool_use' },
        ],
      }),
      '/tmp/project',
      mono,
    );
    expect(noisy).not.toContain('tool_use');
  });

  it('shows a waiting placeholder when the activity history is empty', () => {
    const output = renderDashboard(
      sampleState({ events: [], status: 'RUNNING' }),
      '/tmp/project',
      mono,
    );
    expect(output).toContain('Waiting');
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
