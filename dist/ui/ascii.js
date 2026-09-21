import chalk from 'chalk';
import { roles } from '../roles.js';
const identity = (text) => text;
const MONO_THEME = {
    name: 'mono',
    primary: identity,
    secondary: identity,
    accent: identity,
    success: identity,
    failure: identity,
    muted: identity,
    banner: [identity, identity, identity, identity, identity, identity],
};
const THEMES = {
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
export const THEME_NAMES = ['default', 'ocean', 'forest', 'mono'];
export function resolveTheme(name) {
    if (name !== undefined && name !== '' && !THEME_NAMES.includes(name))
        throw new Error(`Unknown theme '${name}'. Available themes: ${THEME_NAMES.join(', ')}.`);
    if (process.env.NO_COLOR !== undefined || name === 'mono')
        return MONO_THEME;
    if (name === undefined || name === '')
        return THEMES.default;
    return THEMES[name];
}
export const BANNER_LINES = [
    ' █████╗ ██╗    ██████╗ ███████╗██╗   ██╗',
    '██╔══██╗██║    ██╔══██╗██╔════╝██║   ██║',
    '███████║██║    ██║  ██║█████╗  ██║   ██║',
    '██╔══██║██║    ██║  ██║██╔══╝  ╚██╗ ██╔╝',
    '██║  ██║██║    ██████╔╝███████╗ ╚████╔╝',
    '╚═╝  ╚═╝╚═╝    ╚═════╝ ╚══════╝  ╚═══╝',
];
export function renderBanner(theme, version) {
    const art = BANNER_LINES.map((line, index) => {
        const paint = theme.banner[index % theme.banner.length] ?? identity;
        return paint(line);
    });
    const subtitle = theme.muted(' T E A M') +
        theme.secondary('  ·  autonomous coding crew') +
        theme.muted(`  v${version}`);
    return [...art, subtitle, ''].join('\n');
}
// ANSI escape (0x1B) built through the RegExp constructor so linting tools
// that reject control characters inside regex literals stay satisfied.
const ESC = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, 'gu');
const ANSI_SEQUENCE = new RegExp(`^${ESC}\\[[0-9;]*m`);
export function visibleWidth(text) {
    return text.replace(ANSI_PATTERN, '').length;
}
function padVisible(text, width) {
    const missing = width - visibleWidth(text);
    return missing > 0 ? text + ' '.repeat(missing) : text;
}
/** Truncates a string to a visible width without breaking ANSI color sequences. */
export function truncateVisible(text, width) {
    if (visibleWidth(text) <= width)
        return text;
    let result = '';
    let visible = 0;
    let index = 0;
    while (index < text.length && visible < width) {
        if (text.startsWith(ESC + '[', index)) {
            const sequence = ANSI_SEQUENCE.exec(text.slice(index));
            if (sequence) {
                result += sequence[0];
                index += sequence[0].length;
                continue;
            }
        }
        result += text.charAt(index);
        visible += 1;
        index += 1;
    }
    return text.includes(`${ESC}[`) ? `${result}${ESC}[0m` : result;
}
export function panel(title, lines, theme, maxWidth) {
    const fitted = maxWidth === undefined
        ? lines
        : lines.map((line) => truncateVisible(line, Math.max(8, maxWidth - 4)));
    const width = Math.max(visibleWidth(title) + 2, ...fitted.map((line) => visibleWidth(line)));
    const fill = Math.max(1, width - visibleWidth(title) - 1);
    const border = theme.primary;
    return [
        border(`╭─ ${title} ${'─'.repeat(fill)}╮`),
        ...fitted.map((line) => `${border('│')} ${padVisible(line, width)} ${border('│')}`),
        border(`╰${'─'.repeat(width + 2)}╯`),
    ].join('\n');
}
export function progressBar(completed, total, width = 28) {
    const safeTotal = Math.max(0, total);
    const safeCompleted = Math.min(Math.max(0, completed), safeTotal);
    const percent = safeTotal === 0 ? 0 : Math.round((safeCompleted / safeTotal) * 100);
    const filled = safeTotal === 0 ? 0 : Math.round((safeCompleted / safeTotal) * width);
    return `[${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}] ${percent}%`;
}
export function statusBadge(status, theme) {
    const text = `[ ${status} ]`;
    if (status === 'DONE')
        return theme.success(text);
    if (status === 'FAILED' || status === 'CANCELLED')
        return theme.failure(text);
    if (status === 'RUNNING' || status === 'ACTIVE' || status === 'RETRYING')
        return theme.accent(text);
    return theme.muted(text);
}
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export function spinnerFrame(now = Date.now(), intervalMs = 120) {
    const index = Math.floor(now / Math.max(1, intervalMs)) % SPINNER_FRAMES.length;
    return SPINNER_FRAMES[index] ?? '⠋';
}
export function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0)
        return `${hours}h ${minutes}m`;
    if (minutes > 0)
        return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}
export function estimateEtaMs(completed, total, elapsedMs) {
    if (completed <= 0 || total <= completed || elapsedMs <= 0)
        return undefined;
    return Math.round((elapsedMs / completed) * (total - completed));
}
const LOW_VALUE_ACTIVITY = /(?:event:\s*)?(?:step_start|step_finish|tool_use)\b/i;
/** How many recent events the dashboard Activity panel lists inline. */
const ACTIVITY_PANEL_ROWS = 4;
/** Returns the id of the innermost region containing the point, if any. */
export function hitTest(rects, x, y) {
    let match;
    for (const rect of rects) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
            match = rect.id;
    }
    return match;
}
export function renderDashboard(state, root, theme, options = {}) {
    const completed = state.completedPhases ?? 0;
    const total = state.totalPhases ?? 5;
    const now = options.now ?? Date.now();
    const startedMs = state.startedAt ? Date.parse(state.startedAt) : Number.NaN;
    const finishedMs = state.status === 'RUNNING' || !state.updatedAt ? now : Date.parse(state.updatedAt);
    const elapsedMs = Number.isNaN(startedMs) ? 0 : Math.max(0, finishedMs - startedMs);
    const eta = estimateEtaMs(completed, total, elapsedMs);
    const latest = new Map(state.events.map((event) => [event.roleId, event.status]));
    const visibleEvents = state.events.filter((candidate) => options.verbose || !LOW_VALUE_ACTIVITY.test(candidate.message));
    const event = [...visibleEvents].reverse()[0];
    const retry = [...state.events].reverse().find((candidate) => candidate.status === 'RETRYING');
    const attempt = event?.attempt ? `${event.attempt}/${event.maxAttempts ?? event.attempt}` : '-';
    const spinner = state.status === 'RUNNING' ? `${spinnerFrame(now)} ` : '';
    const lastEvent = state.events.at(-1);
    const lastEventMs = lastEvent?.timestamp === undefined ? Number.NaN : Date.parse(lastEvent.timestamp);
    const idleMs = Number.isNaN(lastEventMs) ? undefined : Math.max(0, now - lastEventMs);
    const hotspots = options.hotspots;
    let cursorY = options.offsetY ?? 0;
    const place = (id, block, rowIds) => {
        const lines = block.split('\n');
        const width = Math.max(0, ...lines.map((line) => visibleWidth(line)));
        hotspots?.push({ id, top: cursorY + 1, left: 1, bottom: cursorY + lines.length, right: width });
        // Content rows sit one line below the top border, one per entry.
        rowIds?.forEach((rowId, index) => {
            const y = cursorY + 2 + index;
            hotspots?.push({ id: rowId, top: y, left: 2, bottom: y, right: width - 1 });
        });
        cursorY += lines.length;
        return block;
    };
    const overview = panel('Overview', [
        `${spinner}${theme.secondary('Status:')} ${statusBadge(state.status, theme)}   ${theme.secondary('Elapsed:')} ${formatDuration(elapsedMs)}${eta === undefined ? '' : `   ${theme.secondary('ETA:')} ~${formatDuration(eta)}`}`,
        `${theme.accent(progressBar(completed, total))} ${theme.muted(`(${completed}/${total} phases)`)}`,
        `${theme.secondary('Goal:')}  ${state.goal.slice(0, 96)}`,
        `${theme.secondary('Path:')}  ${root}`,
        `${theme.secondary('Model:')} ${state.model ?? theme.muted('runtime default')}`,
        `${theme.secondary('Phase:')} ${state.currentRoleId ?? (state.status === 'RUNNING' ? 'waiting' : 'complete')}  ${theme.secondary('Attempt:')} ${attempt}`,
        theme.muted('Clicks: this panel, Activity, agent rows · keys: g a h 1-8 · Esc closes'),
    ], theme, options.maxWidth);
    const agents = panel('Agents', roles.map((role) => ` ${theme.accent('▸')} ${role.name.padEnd(19)} ${statusBadge(latest.get(role.id) ?? 'WAITING', theme)}`), theme, options.maxWidth);
    const idleLabel = idleMs === undefined
        ? 'unknown'
        : idleMs > 60_000
            ? theme.accent(`${formatDuration(idleMs)} — model is still generating, no new events yet`)
            : formatDuration(idleMs);
    const recentActivity = [...visibleEvents].slice(-ACTIVITY_PANEL_ROWS);
    const activity = panel('Activity', [
        // A short inline history: role, status badge, and the first line of each
        // message, so the dashboard shows what the agent is actually doing
        // (which command ran, which file was touched) instead of one line.
        ...(recentActivity.length === 0
            ? ['Waiting']
            : recentActivity.map((activityEvent) => {
                const headline = (activityEvent.message.split('\n')[0] ?? '').trim();
                const label = `${activityEvent.roleId} [ ${activityEvent.status} ]`;
                return `${theme.secondary(label.padEnd(30))} ${headline}`;
            })),
        `${theme.secondary('Retry:')}  ${retry ? (retry.message.split('\n')[0] ?? '').slice(0, 120) : 'none'}`,
        `${theme.secondary('Idle:')}   ${idleLabel}   ${theme.secondary('Events:')} ${state.events.length}`,
    ], theme, options.maxWidth);
    const sections = [
        place('overview', overview),
        place('agents', agents, roles.map((role) => `agent:${role.id}`)),
        place('activity', activity),
    ];
    if (state.status !== 'RUNNING')
        sections.push(place('summary', renderSummary(state, theme, options.maxWidth)));
    return sections.join('\n');
}
export function renderSummary(state, theme, maxWidth) {
    const failures = state.events.filter((event) => event.status === 'FAILED');
    const failedRoles = [...new Set(failures.map((event) => event.roleId))];
    const startedMs = state.startedAt ? Date.parse(state.startedAt) : Number.NaN;
    const finishedMs = state.updatedAt ? Date.parse(state.updatedAt) : Date.now();
    const duration = Number.isNaN(startedMs)
        ? 'unknown'
        : formatDuration(Math.max(0, finishedMs - startedMs));
    const headline = state.status === 'DONE'
        ? theme.success('✔ Implementation, verification, and review completed.')
        : theme.failure(`✖ ${failedRoles.length} agent(s) failed (${failedRoles.join(', ')}); inspect .ai-dev-team logs and retry after addressing the latest diagnostic.`);
    const lines = [
        headline,
        `${theme.secondary('Duration:')} ${duration}  ${theme.secondary('Fix cycles:')} ${state.attempts}  ${theme.secondary('Sessions:')} ${state.sessions.length}  ${theme.secondary('Events:')} ${state.events.length}`,
    ];
    const rootCause = failures.at(-1);
    if (rootCause !== undefined)
        lines.push(`${theme.secondary('Root cause:')} ${rootCause.roleId}: ${(rootCause.message.split('\n')[0] ?? '').slice(0, 480)}`);
    return panel('Run summary', lines, theme, maxWidth);
}
