import chalk from 'chalk';
import { roles } from '../roles.js';
import type { RuntimeWorkflowState } from '../runtimes/runtime-orchestrator.js';

export type ThemeName = 'default' | 'ocean' | 'forest' | 'mono';

export interface Theme {
  name: ThemeName;
  primary: (text: string) => string;
  secondary: (text: string) => string;
  accent: (text: string) => string;
  success: (text: string) => string;
  failure: (text: string) => string;
  muted: (text: string) => string;
  banner: Array<(text: string) => string>;
}

const identity = (text: string): string => text;

const MONO_THEME: Theme = {
  name: 'mono',
  primary: identity,
  secondary: identity,
  accent: identity,
  success: identity,
  failure: identity,
  muted: identity,
  banner: [identity, identity, identity, identity, identity, identity],
};

const THEMES: Record<Exclude<ThemeName, 'mono'>, Theme> = {
  default: {
    name: 'default',
    primary: chalk.cyan,
    secondary: chalk.white,
    accent: chalk.yellow,
    success: chalk.green,
    failure: chalk.red,
    muted: chalk.gray,
    banner: [
      chalk.cyanBright,
      chalk.cyan,
      chalk.blueBright,
      chalk.blue,
      chalk.magentaBright,
      chalk.magenta,
    ],
  },
  ocean: {
    name: 'ocean',
    primary: chalk.blueBright,
    secondary: chalk.cyan,
    accent: chalk.white,
    success: chalk.greenBright,
    failure: chalk.redBright,
    muted: chalk.gray,
    banner: [
      chalk.blue,
      chalk.blueBright,
      chalk.cyan,
      chalk.cyanBright,
      chalk.white,
      chalk.cyanBright,
    ],
  },
  forest: {
    name: 'forest',
    primary: chalk.green,
    secondary: chalk.greenBright,
    accent: chalk.yellowBright,
    success: chalk.greenBright,
    failure: chalk.red,
    muted: chalk.gray,
    banner: [
      chalk.green,
      chalk.greenBright,
      chalk.yellow,
      chalk.yellowBright,
      chalk.white,
      chalk.greenBright,
    ],
  },
};

export const THEME_NAMES: readonly ThemeName[] = ['default', 'ocean', 'forest', 'mono'];

export function resolveTheme(name?: string): Theme {
  if (name !== undefined && name !== '' && !THEME_NAMES.includes(name as ThemeName))
    throw new Error(`Unknown theme '${name}'. Available themes: ${THEME_NAMES.join(', ')}.`);
  if (process.env.NO_COLOR !== undefined || name === 'mono') return MONO_THEME;
  if (name === undefined || name === '') return THEMES.default;
  return THEMES[name as Exclude<ThemeName, 'mono'>];
}

export const BANNER_LINES = [
  ' █████╗ ██╗    ██████╗ ███████╗██╗   ██╗',
  '██╔══██╗██║    ██╔══██╗██╔════╝██║   ██║',
  '███████║██║    ██║  ██║█████╗  ██║   ██║',
  '██╔══██║██║    ██║  ██║██╔══╝  ╚██╗ ██╔╝',
  '██║  ██║██║    ██████╔╝███████╗ ╚████╔╝',
  '╚═╝  ╚═╝╚═╝    ╚═════╝ ╚══════╝  ╚═══╝',
];

export function renderBanner(theme: Theme, version: string): string {
  const art = BANNER_LINES.map((line, index) => {
    const paint = theme.banner[index % theme.banner.length] ?? identity;
    return paint(line);
  });
  const subtitle =
    theme.muted(' T E A M') +
    theme.secondary('  ·  autonomous coding crew') +
    theme.muted(`  v${version}`);
  return [...art, subtitle, ''].join('\n');
}

const ANSI_PATTERN = /\x1B\[[0-9;]*m/g;

export function visibleWidth(text: string): number {
  return text.replace(ANSI_PATTERN, '').length;
}

function padVisible(text: string, width: number): string {
  const missing = width - visibleWidth(text);
  return missing > 0 ? text + ' '.repeat(missing) : text;
}

export function panel(title: string, lines: string[], theme: Theme): string {
  const width = Math.max(visibleWidth(title) + 2, ...lines.map((line) => visibleWidth(line)));
  const fill = Math.max(1, width - visibleWidth(title) - 1);
  const border = theme.primary;
  return [
    border(`╭─ ${title} ${'─'.repeat(fill)}╮`),
    ...lines.map((line) => `${border('│')} ${padVisible(line, width)} ${border('│')}`),
    border(`╰${'─'.repeat(width + 2)}╯`),
  ].join('\n');
}

export function progressBar(completed: number, total: number, width = 28): string {
  const safeTotal = Math.max(0, total);
  const safeCompleted = Math.min(Math.max(0, completed), safeTotal);
  const percent = safeTotal === 0 ? 0 : Math.round((safeCompleted / safeTotal) * 100);
  const filled = safeTotal === 0 ? 0 : Math.round((safeCompleted / safeTotal) * width);
  return `[${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}] ${percent}%`;
}

export function statusBadge(status: string, theme: Theme): string {
  const text = `[ ${status} ]`;
  if (status === 'DONE') return theme.success(text);
  if (status === 'FAILED' || status === 'CANCELLED') return theme.failure(text);
  if (status === 'RUNNING' || status === 'ACTIVE' || status === 'RETRYING')
    return theme.accent(text);
  return theme.muted(text);
}

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function spinnerFrame(now = Date.now(), intervalMs = 120): string {
  const index = Math.floor(now / Math.max(1, intervalMs)) % SPINNER_FRAMES.length;
  return SPINNER_FRAMES[index] ?? '⠋';
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function estimateEtaMs(
  completed: number,
  total: number,
  elapsedMs: number,
): number | undefined {
  if (completed <= 0 || total <= completed || elapsedMs <= 0) return undefined;
  return Math.round((elapsedMs / completed) * (total - completed));
}

const LOW_VALUE_ACTIVITY = /(?:event:\s*)?(?:step_start|step_finish|tool_use)\b/i;

export interface DashboardOptions {
  verbose?: boolean;
  now?: number;
}

export function renderDashboard(
  state: RuntimeWorkflowState,
  root: string,
  theme: Theme,
  options: DashboardOptions = {},
): string {
  const completed = state.completedPhases ?? 0;
  const total = state.totalPhases ?? 5;
  const now = options.now ?? Date.now();
  const startedMs = state.startedAt ? Date.parse(state.startedAt) : Number.NaN;
  const finishedMs =
    state.status === 'RUNNING' || !state.updatedAt ? now : Date.parse(state.updatedAt);
  const elapsedMs = Number.isNaN(startedMs) ? 0 : Math.max(0, finishedMs - startedMs);
  const eta = estimateEtaMs(completed, total, elapsedMs);

  const latest = new Map(state.events.map((event) => [event.roleId, event.status]));
  const event = [...state.events]
    .reverse()
    .find((candidate) => options.verbose || !LOW_VALUE_ACTIVITY.test(candidate.message));
  const retry = [...state.events].reverse().find((candidate) => candidate.status === 'RETRYING');
  const attempt = event?.attempt ? `${event.attempt}/${event.maxAttempts ?? event.attempt}` : '-';
  const spinner = state.status === 'RUNNING' ? `${spinnerFrame(now)} ` : '';

  const overview = panel(
    'Overview',
    [
      `${spinner}${theme.secondary('Status:')} ${statusBadge(state.status, theme)}   ${theme.secondary('Elapsed:')} ${formatDuration(elapsedMs)}${eta === undefined ? '' : `   ${theme.secondary('ETA:')} ~${formatDuration(eta)}`}`,
      `${theme.accent(progressBar(completed, total))} ${theme.muted(`(${completed}/${total} phases)`)}`,
      `${theme.secondary('Goal:')}  ${state.goal.slice(0, 96)}`,
      `${theme.secondary('Path:')}  ${root}`,
      `${theme.secondary('Phase:')} ${state.currentRoleId ?? (state.status === 'RUNNING' ? 'waiting' : 'complete')}  ${theme.secondary('Attempt:')} ${attempt}`,
    ],
    theme,
  );
  const agents = panel(
    'Agents',
    roles.map(
      (role) =>
        ` ${theme.accent('▸')} ${role.name.padEnd(19)} ${statusBadge(latest.get(role.id) ?? 'WAITING', theme)}`,
    ),
    theme,
  );
  const activity = panel(
    'Activity',
    [
      `${theme.secondary('Latest:')} ${event ? `${event.roleId}: ${(event.message.split('\n')[0] ?? '').slice(0, 120)}` : 'Waiting'}`,
      `${theme.secondary('Retry:')}  ${retry ? (retry.message.split('\n')[0] ?? '').slice(0, 120) : 'none'}`,
    ],
    theme,
  );
  const sections = [overview, agents, activity];
  if (state.status !== 'RUNNING') sections.push(renderSummary(state, theme));
  return sections.join('\n');
}

export function renderSummary(state: RuntimeWorkflowState, theme: Theme): string {
  const failures = state.events.filter((event) => event.status === 'FAILED');
  const startedMs = state.startedAt ? Date.parse(state.startedAt) : Number.NaN;
  const finishedMs = state.updatedAt ? Date.parse(state.updatedAt) : Date.now();
  const duration = Number.isNaN(startedMs)
    ? 'unknown'
    : formatDuration(Math.max(0, finishedMs - startedMs));
  const headline =
    state.status === 'DONE'
      ? theme.success('✔ Implementation, verification, and review completed.')
      : theme.failure(
          `✖ ${failures.length} terminal failure(s); inspect .ai-dev-team logs and retry after addressing the latest diagnostic.`,
        );
  return panel(
    'Run summary',
    [
      headline,
      `${theme.secondary('Duration:')} ${duration}  ${theme.secondary('Fix cycles:')} ${state.attempts}  ${theme.secondary('Sessions:')} ${state.sessions.length}  ${theme.secondary('Events:')} ${state.events.length}`,
    ],
    theme,
  );
}
