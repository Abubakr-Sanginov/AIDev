import { roles } from '../roles.js';
import { BANNER_LINES, formatDuration, spinnerFrame } from './ascii.js';
/**
 * Claude Code-style chat rendering, kept free of terminal I/O so it can be
 * unit-tested: the header block, per-role message blocks, event lines, the
 * run summary, the live status line, and the raw-key parser used by the
 * interactive view.
 */
const identity = (text) => text;
export function renderChatHeader(theme, info) {
    const art = BANNER_LINES.map((line, index) => (theme.banner[index % theme.banner.length] ?? identity)(line));
    return [
        ...art,
        ` ${theme.bold('AI Dev Team')}  ${theme.muted(`v${info.version}`)}`,
        ` ${theme.secondary(info.runtimeName)} ${theme.muted('·')} ${theme.accent(info.modelLabel)}`,
        ` ${theme.muted(info.root)}`,
        '',
        theme.muted(' Describe the task — the Manager plans it, the team builds and verifies it.'),
        '',
    ].join('\n');
}
export function roleDisplayName(roleId) {
    if (roleId === 'user')
        return 'You';
    if (roleId === 'browser')
        return 'Browser check';
    return roles.find((role) => role.id === roleId)?.name ?? roleId;
}
/** 850 → '850', 54_800 → '54.8k', 1_250_000 → '1.25M'. */
export function formatTokens(count) {
    if (count >= 1_000_000)
        return `${(count / 1_000_000).toFixed(2)}M`;
    if (count >= 1_000)
        return `${(count / 1_000).toFixed(1)}k`;
    return String(Math.max(0, Math.round(count)));
}
export function wordWrap(text, width) {
    const safeWidth = Math.max(1, width);
    const lines = [];
    for (const paragraph of text.split(/\r?\n/u)) {
        if (paragraph.trim() === '') {
            lines.push('');
            continue;
        }
        let current = '';
        for (const word of paragraph.split(/\s+/u)) {
            // Words longer than the line are hard-broken instead of overflowing.
            if (word.length > safeWidth) {
                if (current !== '') {
                    lines.push(current);
                    current = '';
                }
                for (let offset = 0; offset < word.length; offset += safeWidth)
                    lines.push(word.slice(offset, offset + safeWidth));
                continue;
            }
            const candidate = current === '' ? word : `${current} ${word}`;
            if (candidate.length > safeWidth && current !== '') {
                lines.push(current);
                current = word;
            }
            else {
                current = candidate;
            }
        }
        if (current !== '')
            lines.push(current);
    }
    return lines.length === 0 ? [''] : lines;
}
export const MAX_ROLE_TEXT_LINES = 100;
/** The complete message block for one finished agent: header, text, meta line. */
export function renderRoleBlock(theme, info, width) {
    const safeWidth = Math.max(40, width);
    const header = info.includeHeader === false ? [] : [theme.bold(`● ${roleDisplayName(info.roleId)}`)];
    const indent = '  ';
    let wrapped = wordWrap(info.text.trim(), safeWidth - indent.length);
    const maxLines = info.maxTextLines ?? MAX_ROLE_TEXT_LINES;
    if (wrapped.length > maxLines) {
        wrapped = [
            ...wrapped.slice(0, maxLines),
            theme.muted(`… (${wrapped.length - maxLines} more lines — full artifact: ai-dev-team logs)`),
        ];
    }
    const meta = [];
    const startedMs = info.startedAt === undefined ? Number.NaN : Date.parse(info.startedAt);
    const finishedMs = info.finishedAt === undefined ? Number.NaN : Date.parse(info.finishedAt);
    if (!Number.isNaN(startedMs) && !Number.isNaN(finishedMs)) {
        const elapsed = Math.max(0, finishedMs - startedMs);
        meta.push(elapsed < 1_000 ? '<1s' : formatDuration(elapsed));
    }
    if (info.toolCalls > 0)
        meta.push(`${info.toolCalls} tool call${info.toolCalls === 1 ? '' : 's'}`);
    const metaLine = meta.length === 0
        ? undefined
        : theme.muted(`${indent}${theme.success('✓')} ${meta.join(' · ')}`);
    return [...header, ...wrapped.map((line) => indent + line), ...(metaLine ? [metaLine] : [])].join('\n');
}
const NOT_SCHEDULED = 'Agent was not scheduled for this workflow.';
/**
 * One scrollback line for a non-role event (retry, skip, cancel, browser
 * progress). Returns undefined for noise that must not be printed.
 */
export function renderEventLine(theme, event, width) {
    const firstLine = (event.message.split('\n')[0] ?? '').trim();
    if (event.status === 'SKIPPED' && (firstLine === '' || firstLine === NOT_SCHEDULED))
        return undefined;
    const indent = '  ';
    const headline = firstLine === '' ? '' : truncatePlain(firstLine, Math.max(24, width - 4));
    switch (event.status) {
        case 'ACTIVE':
            // Pseudo-role progress (browser check steps, pause notices) stays muted.
            return `${indent}${theme.muted(`· ${headline}`)}`;
        case 'RETRYING':
            return `${indent}${theme.accent('↻')} ${theme.accent(headline)}`;
        case 'FAILED':
            return `${indent}${theme.failure('✖')} ${theme.failure(headline)}`;
        case 'CANCELLED':
            return `${indent}${theme.muted('⏹ cancelled')}`;
        case 'SKIPPED':
            return `${indent}${theme.muted(`– ${headline}`)}`;
        case 'DONE':
            return `${indent}${theme.success('✓')} ${theme.muted(headline)}`;
        default:
            return undefined;
    }
}
function truncatePlain(text, width) {
    return text.length <= width ? text : `${text.slice(0, Math.max(1, width - 1))}…`;
}
/** Final one-line verdict for a finished run, like `(14m 25s · ↑ 54.8k tokens)`. */
export function renderRunSummary(theme, state, now) {
    const startedMs = state.startedAt === undefined ? Number.NaN : Date.parse(state.startedAt);
    const finishedMs = state.status === 'RUNNING' || state.updatedAt === undefined ? now : Date.parse(state.updatedAt);
    const elapsed = Number.isNaN(startedMs) || Number.isNaN(finishedMs)
        ? undefined
        : formatDuration(Math.max(0, finishedMs - startedMs - (state.pausedMs ?? 0)));
    const stats = [];
    if (elapsed !== undefined)
        stats.push(elapsed);
    if (state.tokensUsed !== undefined && state.tokensUsed > 0)
        stats.push(`↑ ${formatTokens(state.tokensUsed)} tokens`);
    const suffix = stats.length === 0 ? '' : ` (${stats.join(' · ')})`;
    if (state.status === 'DONE')
        return theme.success(`✔ Task complete${suffix}`);
    if (state.failureReason === 'Interrupted by user.')
        return theme.muted(`⏹ Interrupted${suffix}`);
    const reason = state.failureReason ?? 'The workflow did not pass its quality gates.';
    return theme.failure(`✖ Task failed: ${truncatePlain(reason, 160)}${suffix}`);
}
/** The live spinner row shown above the input box while the team works. */
export function renderStatusLine(theme, options) {
    const { state } = options;
    const now = options.now ?? Date.now();
    const width = Math.max(40, process.stdout.columns || 100);
    const parts = [];
    if (state.pause === 'paused') {
        parts.push(`${theme.accent('⏸ paused')} ${theme.muted('— resume with ctrl+p')}`);
    }
    else if (state.pause === 'pausing') {
        parts.push(`${theme.accent('⏸ pausing')} ${theme.muted('— the current step finishes first')}`);
    }
    else {
        const role = state.currentRoleId === undefined ? undefined : roleDisplayName(state.currentRoleId);
        const activity = (options.activity ?? '').trim();
        const headline = activity === '' ? 'working' : truncatePlain(activity.split('\n')[0] ?? '', 60);
        parts.push(`${theme.accent(options.frame ?? spinnerFrame(now))} ${theme.secondary(role ?? 'Team')} ${theme.muted('—')} ${headline}`);
    }
    const startedMs = state.startedAt === undefined ? Number.NaN : Date.parse(state.startedAt);
    if (!Number.isNaN(startedMs)) {
        const elapsed = Math.max(0, now - startedMs - (state.pausedMs ?? 0));
        parts.push(theme.muted(formatDuration(elapsed)));
    }
    const lines = [parts.join(' ')];
    if (options.queued !== undefined && options.queued !== '')
        lines.push(theme.muted(`⏎ queued: ${truncatePlain(options.queued, width - 12)}`));
    return lines.join('\n');
}
const ESC = String.fromCharCode(27);
// Built through the RegExp constructor: lint rules reject control characters
// inside regex literals (same convention as ascii.ts).
const CSI_PATTERN = new RegExp(`^${ESC}\\[[0-9;]*([A-Za-z~])`, 'u');
const SS3_PATTERN = new RegExp(`^${ESC}O([A-Z])`, 'u');
/**
 * Parses a raw stdin chunk into chat input events: printable runs (including
 * Cyrillic), Enter, Backspace, Esc, arrows, and the control keys the chat view
 * binds (ctrl+c exit, ctrl+p pause, ctrl+u clear line).
 */
export function parseChatKeys(chunk) {
    const events = [];
    let index = 0;
    while (index < chunk.length) {
        const rest = chunk.slice(index);
        if (rest.startsWith(ESC)) {
            const csi = CSI_PATTERN.exec(rest);
            if (csi) {
                if (csi[1] === 'A')
                    events.push({ type: 'up' });
                else if (csi[1] === 'B')
                    events.push({ type: 'down' });
                index += csi[0].length;
                continue;
            }
            const ss3 = SS3_PATTERN.exec(rest);
            if (ss3) {
                if (ss3[1] === 'A')
                    events.push({ type: 'up' });
                else if (ss3[1] === 'B')
                    events.push({ type: 'down' });
                index += ss3[0].length;
                continue;
            }
            events.push({ type: 'escape' });
            index += 1;
            continue;
        }
        const code = chunk.charCodeAt(index);
        if (code === 13 || code === 10) {
            events.push({ type: 'enter' });
            index += 1;
            continue;
        }
        if (code === 127 || code === 8) {
            events.push({ type: 'backspace' });
            index += 1;
            continue;
        }
        if (code === 3) {
            events.push({ type: 'ctrl-c' });
            index += 1;
            continue;
        }
        if (code === 21) {
            events.push({ type: 'ctrl-u' });
            index += 1;
            continue;
        }
        if (code === 16) {
            events.push({ type: 'ctrl-p' });
            index += 1;
            continue;
        }
        if (code < 32) {
            // Unbound control characters are ignored.
            index += 1;
            continue;
        }
        // A run of printable characters (one keystroke, possibly many code units).
        let end = index;
        while (end < chunk.length) {
            const next = chunk.charCodeAt(end);
            if (next === 27 || next < 32 || next === 127)
                break;
            end += 1;
        }
        events.push({ type: 'char', text: chunk.slice(index, end) });
        index = end;
    }
    return events;
}
const TOOL_CALL_MESSAGE = /^Tool call:\s*(\S+)/u;
/**
 * Turns new workflow events into scrollback lines. Stateful only in the
 * "already rendered" cursor and per-role counters; no terminal I/O.
 */
export class ChatRenderer {
    #theme;
    #rendered = 0;
    #currentRoleId;
    #currentRoleStartedAt;
    #roleToolCalls = 0;
    #roleHeaderPrinted = false;
    #activity;
    constructor(theme) {
        this.#theme = theme;
    }
    get latestActivity() {
        return this.#activity;
    }
    consume(state, width) {
        const lines = [];
        let activity;
        const events = state.events.slice(this.#rendered);
        this.#rendered = state.events.length;
        for (const event of events) {
            const isPseudo = event.roleId === 'user' || event.roleId === 'browser';
            if (event.status === 'RUNNING') {
                this.#currentRoleId = event.roleId;
                this.#currentRoleStartedAt = event.timestamp;
                this.#roleToolCalls = 0;
                this.#roleHeaderPrinted = false;
                // A new role starts with no activity of its own yet; surfacing the
                // reset (instead of the previous role's last tool call) keeps the
                // status line honest.
                this.#activity = '';
                activity = '';
                if (!isPseudo) {
                    lines.push(this.#theme.bold(`● ${roleDisplayName(event.roleId)}`));
                    this.#roleHeaderPrinted = true;
                }
                continue;
            }
            if (event.status === 'ACTIVE') {
                if (isPseudo) {
                    const line = renderEventLine(this.#theme, event, width);
                    if (line !== undefined)
                        lines.push(line);
                    continue;
                }
                if (event.roleId === this.#currentRoleId) {
                    const toolCall = TOOL_CALL_MESSAGE.exec(event.message);
                    if (toolCall) {
                        this.#roleToolCalls += 1;
                        this.#activity = `Running ${toolCall[1]}…`;
                    }
                    else {
                        this.#activity = event.message;
                    }
                    activity = this.#activity;
                }
                continue;
            }
            if (event.status === 'DONE') {
                if (isPseudo) {
                    const line = renderEventLine(this.#theme, event, width);
                    if (line !== undefined)
                        lines.push(line);
                }
                else {
                    lines.push(renderRoleBlock(this.#theme, {
                        roleId: event.roleId,
                        text: event.message,
                        startedAt: this.#currentRoleStartedAt,
                        finishedAt: event.timestamp,
                        toolCalls: this.#roleToolCalls,
                        // The header was printed when the role started; repeating it
                        // would read as two separate blocks.
                        includeHeader: !this.#roleHeaderPrinted,
                    }, width));
                }
                this.#currentRoleId = undefined;
                this.#currentRoleStartedAt = undefined;
                this.#roleToolCalls = 0;
                this.#roleHeaderPrinted = false;
                continue;
            }
            // RETRYING / FAILED / SKIPPED / CANCELLED
            const line = renderEventLine(this.#theme, event, width);
            if (line !== undefined)
                lines.push(line);
            if (event.status === 'FAILED' || event.status === 'CANCELLED') {
                this.#currentRoleId = undefined;
                this.#currentRoleStartedAt = undefined;
                this.#roleToolCalls = 0;
                this.#roleHeaderPrinted = false;
            }
        }
        return { lines, ...(activity === undefined ? {} : { activity }) };
    }
}
