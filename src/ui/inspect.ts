import { roles } from '../roles.js';
import type { RuntimeWorkflowState } from '../runtimes/runtime-orchestrator.js';
import { formatDuration, truncateVisible, visibleWidth, type Theme } from './ascii.js';

/** Terminal viewport the overlay must fit into. */
export interface Viewport {
  width: number;
  height: number;
}

export interface OverlayView {
  /** All lines fit the viewport exactly: nothing stale is left on screen. */
  lines: string[];
  /** Total content lines available for scrolling (before the viewport cut). */
  total: number;
}

function clean(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim();
}

/** Wraps plain text to a visible width, breaking long unspaced tokens. */
export function wrapText(text: string, width: number): string[] {
  const limit = Math.max(8, width);
  const output: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    if (line === '') {
      output.push('');
      continue;
    }
    let current = '';
    for (const word of line.split(' ')) {
      let token = word;
      while (token.length > limit) {
        if (current !== '') {
          output.push(current);
          current = '';
        }
        output.push(token.slice(0, limit));
        token = token.slice(limit);
      }
      if (current === '') current = token;
      else if (current.length + 1 + token.length <= limit) current = `${current} ${token}`;
      else {
        output.push(current);
        current = token;
      }
    }
    output.push(current);
  }
  return output;
}

function timestampOf(value?: string): string {
  if (value === undefined) return '--:--:--';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return '--:--:--';
  return new Date(parsed).toTimeString().slice(0, 8);
}

function header(title: string, hint: string, theme: Theme, width: number): string {
  const left = `▌ ${title}`;
  const right = `${hint} `;
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  return truncateVisible(theme.primary(left) + theme.muted(' '.repeat(gap) + right), width);
}

function footer(
  state: RuntimeWorkflowState,
  scroll: number,
  total: number,
  theme: Theme,
  width: number,
): string {
  const position = total === 0 ? '0/0' : `${Math.min(total, Math.max(1, total - scroll))}/${total}`;
  const text = `↑/↓ scroll · PgUp/PgDn page · Home top · End latest · Esc/click closes · ${position} lines`;
  return truncateVisible(
    theme.muted(text) + (state.status === 'RUNNING' ? theme.accent('   (live)') : ''),
    width,
  );
}

function fit(
  lines: string[],
  viewport: Viewport,
  scroll: number,
): { body: string[]; total: number } {
  const bodyHeight = Math.max(1, viewport.height - 2);
  const total = lines.length;
  const maxStart = Math.max(0, total - bodyHeight);
  const start = Math.max(0, maxStart - Math.max(0, scroll));
  const body = lines.slice(start, start + bodyHeight);
  while (body.length < bodyHeight) body.push('');
  return { body, total };
}

/** Full goal text plus the run metadata, wrapped instead of truncated. */
export function renderGoalView(
  state: RuntimeWorkflowState,
  theme: Theme,
  viewport: Viewport,
  scroll: number,
): OverlayView {
  const width = Math.max(20, viewport.width);
  const contentWidth = Math.max(16, width - 4);
  const lines: string[] = [
    theme.secondary(
      `Runtime: ${state.runtimeId}   Model: ${state.model ?? 'runtime default'}   Status: ${state.status}`,
    ),
    theme.secondary(
      `Phase: ${state.currentRoleId ?? 'complete'}   Fix cycles: ${state.attempts}   Events: ${state.events.length}`,
    ),
    '',
    theme.accent('Goal (full text):'),
    ...wrapText(state.goal, contentWidth).map((line) => `  ${line}`),
    '',
    theme.accent('Per-role last message:'),
  ];
  for (const role of roles) {
    const last = [...state.events].reverse().find((event) => event.roleId === role.id);
    const status = last ? `[ ${last.status} ]` : '[ WAITING ]';
    const message = last ? clean(last.message).slice(0, Math.max(8, contentWidth - 30)) : 'not scheduled yet';
    lines.push(`  ${role.name.padEnd(19)} ${theme.muted(status)} ${message}`);
  }
  const fitted = fit(lines, viewport, scroll);
  return {
    total: fitted.total,
    lines: [
      header('Goal', 'Esc close · click anywhere closes', theme, width),
      ...fitted.body,
      footer(state, scroll, fitted.total, theme, width),
    ],
  };
}

/** Entire event history with timestamps, newest at the bottom. */
export function renderActivityView(
  state: RuntimeWorkflowState,
  theme: Theme,
  viewport: Viewport,
  scroll: number,
): OverlayView {
  const width = Math.max(20, viewport.width);
  const contentWidth = Math.max(16, width - 4);
  const lines: string[] = [];
  state.events.forEach((event, index) => {
    const prefix = `#${String(index + 1).padStart(3, '0')} ${timestampOf(event.timestamp)} ${event.roleId.padEnd(19)} [ ${event.status} ]`;
    const [first = '', ...rest] = event.message.split('\n');
    lines.push(`${prefix} ${first}`.trimEnd());
    for (const continuation of rest)
      for (const wrapped of wrapText(continuation, contentWidth - 6)) lines.push(`      ${wrapped}`);
  });
  if (lines.length === 0) lines.push(theme.muted('No events yet.'));
  const fitted = fit(lines, viewport, scroll);
  return {
    total: fitted.total,
    lines: [
      header(`Activity — ${state.events.length} events`, 'Esc close · wheel scrolls', theme, width),
      ...fitted.body,
      footer(state, scroll, fitted.total, theme, width),
    ],
  };
}


/** One role: every event it produced, its sessions, and its budget. */
export function renderAgentView(
  state: RuntimeWorkflowState,
  roleId: string,
  theme: Theme,
  viewport: Viewport,
  scroll: number,
): OverlayView {
  const width = Math.max(20, viewport.width);
  const contentWidth = Math.max(16, width - 4);
  const role = roles.find((candidate) => candidate.id === roleId);
  const events = state.events.filter((event) => event.roleId === roleId);
  const sessions = state.sessions.filter((session) => session.roleId === roleId);
  const lines: string[] = [
    theme.secondary(role?.description ?? 'Unknown role'),
    theme.secondary(
      `Budget: ${role ? `${role.budget.maxSteps} steps / ${role.budget.maxToolCalls} tool calls` : 'n/a'}   ` +
        `File access: ${role?.canModifyFiles === true ? 'write' : 'read-only'}   Sessions: ${sessions.length}   Events: ${events.length}`,
    ),
    '',
    theme.accent('Events:'),
  ];
  events.forEach((event, index) => {
    lines.push(`  ${theme.muted(`#${index + 1} ${timestampOf(event.timestamp)}`)} [ ${event.status} ]`);
    for (const wrapped of wrapText(event.message, contentWidth - 4)) lines.push(`    ${wrapped}`);
  });
  if (events.length === 0) lines.push(theme.muted('  No events yet for this role.'));
  if (sessions.length > 0) {
    lines.push('', theme.accent('Sessions:'));
    for (const session of sessions) {
      const created = timestampOf(session.createdAt);
      const duration =
        session.status === 'running'
          ? ''
          : `   ${formatDuration(Math.max(0, Date.now() - Date.parse(session.createdAt)))}`;
      lines.push(`  ${session.id.slice(0, 8)}  ${created}  ${session.status}${duration}`);
    }
  }
  const fitted = fit(lines, viewport, scroll);
  return {
    total: fitted.total,
    lines: [
      header(`${role?.name ?? roleId} — details`, 'Esc close · wheel scrolls', theme, width),
      ...fitted.body,
      footer(state, scroll, fitted.total, theme, width),
    ],
  };
}

/** Keyboard and mouse reference. */
export function renderHelpView(theme: Theme, viewport: Viewport): OverlayView {
  const width = Math.max(20, viewport.width);
  const lines = [
    theme.accent('Mouse'),
    '  click Overview / Goal panel  → full goal text (the whole request, wrapped)',
    '  click a row in Agents         → that agent: every event, sessions, budget',
    '  click Activity panel          → entire event history with timestamps',
    '  wheel                         → scroll an open view (3 lines per notch)',
    '  click inside an open view     → close it',
    '',
    theme.accent('Keyboard'),
    '  g  goal view        a  activity history     h / ?  this help',
    '  1-8                 agent detail (1 Manager, 2 Architect, 3 Backend, 4 Frontend,',
    '                      5 Coder, 6 Tester, 7 Fixer, 8 Reviewer)',
    '  ↑ / ↓               scroll one line        PgUp / PgDn  scroll one page',
    '  Home / End          jump to top / latest   Esc / q      close the open view',
    '',
    theme.muted('Everything runs on the alternate screen buffer: closing restores your terminal.'),
  ];
  const bodyHeight = Math.max(1, viewport.height - 2);
  const fitted = fit(lines, viewport, 0);
  return {
    total: fitted.total,
    lines: [header('Help', 'Esc close', theme, width), ...fitted.body.slice(0, bodyHeight), ''],
  };
}

