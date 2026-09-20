import { hitTest } from './ascii.js';
/** ESC is built through fromCharCode so lint rules about control chars stay happy. */
const ESC = String.fromCharCode(27);
const SGR_MOUSE = new RegExp(`${ESC}\\[<(\\d+);(\\d+);(\\d+)([Mm])`, 'gu');
const CSI_KEY = new RegExp(`^${ESC}\\[([0-9;]*)([A-Za-z~])`);
function buttonOf(code) {
    if ((code & 64) !== 0)
        return (code & 1) === 0 ? 'wheel-up' : 'wheel-down';
    if ((code & 3) === 0)
        return 'left';
    return 'other';
}
/**
 * Parses a raw stdin chunk into terminal events. Supports SGR mouse reporting
 * (enabled with ?1006h), arrow keys, paging keys, and plain characters.
 */
export function parseTerminalInput(chunk) {
    const events = [];
    let consumedUntil = 0;
    let match;
    SGR_MOUSE.lastIndex = 0;
    while ((match = SGR_MOUSE.exec(chunk)) !== null) {
        if (match.index > consumedUntil)
            events.push(...parseKeys(chunk.slice(consumedUntil, match.index)));
        events.push({
            type: 'mouse',
            button: buttonOf(Number.parseInt(match[1] ?? '0', 10)),
            x: Number.parseInt(match[2] ?? '0', 10),
            y: Number.parseInt(match[3] ?? '0', 10),
        });
        consumedUntil = match.index + match[0].length;
    }
    if (consumedUntil < chunk.length)
        events.push(...parseKeys(chunk.slice(consumedUntil)));
    return events;
}
function keyForSequence(params, final) {
    if (final === 'A')
        return 'arrow-up';
    if (final === 'B')
        return 'arrow-down';
    if (final === 'C')
        return 'arrow-right';
    if (final === 'D')
        return 'arrow-left';
    if (final === 'H')
        return 'home';
    if (final === 'F')
        return 'end';
    if (final !== '~')
        return undefined;
    if (params === '5')
        return 'page-up';
    if (params === '6')
        return 'page-down';
    if (params === '1' || params === '7')
        return 'home';
    if (params === '4' || params === '8')
        return 'end';
    return undefined;
}
export const INITIAL_UI_STATE = { view: { kind: 'dashboard' }, scroll: 0, hotspots: [] };
const AGENT_KEYS = {
    '1': 'manager',
    '2': 'architect',
    '3': 'backend',
    '4': 'frontend',
    '5': 'coder',
    '6': 'tester',
    '7': 'fixer',
    '8': 'reviewer',
};
const WHEEL_LINES = 3;
function clampScroll(scroll) {
    return Math.max(0, Math.round(scroll));
}
function openView(state, view) {
    return { view, scroll: 0, hotspots: state.hotspots };
}
/** Pure reducer: maps one terminal event to the next UI state. */
export function reduceUiEvent(state, event, pageLines) {
    const page = Math.max(1, pageLines);
    if (event.type === 'mouse') {
        if (state.view.kind === 'dashboard') {
            if (event.button !== 'left')
                return state;
            const target = hitTest(state.hotspots, event.x, event.y);
            if (target === undefined)
                return state;
            if (target === 'overview')
                return openView(state, { kind: 'goal' });
            if (target === 'activity')
                return openView(state, { kind: 'activity' });
            if (target.startsWith('agent:'))
                return openView(state, { kind: 'agent', roleId: target.slice('agent:'.length) });
            return state;
        }
        if (event.button === 'left')
            return openView(state, { kind: 'dashboard' });
        if (event.button === 'wheel-up')
            return { ...state, scroll: clampScroll(state.scroll + WHEEL_LINES) };
        if (event.button === 'wheel-down')
            return { ...state, scroll: clampScroll(state.scroll - WHEEL_LINES) };
        return state;
    }
    const { key } = event;
    if (key === 'escape' || key === 'q')
        return state.view.kind === 'dashboard' ? state : openView(state, { kind: 'dashboard' });
    if (key === 'g')
        return openView(state, { kind: 'goal' });
    if (key === 'a')
        return openView(state, { kind: 'activity' });
    if (key === 'h' || key === '?')
        return openView(state, { kind: 'help' });
    if (state.view.kind === 'dashboard') {
        const roleId = AGENT_KEYS[key];
        return roleId === undefined ? state : openView(state, { kind: 'agent', roleId });
    }
    if (key === 'arrow-up')
        return { ...state, scroll: clampScroll(state.scroll + 1) };
    if (key === 'arrow-down')
        return { ...state, scroll: clampScroll(state.scroll - 1) };
    if (key === 'page-up')
        return { ...state, scroll: clampScroll(state.scroll + page) };
    if (key === 'page-down')
        return { ...state, scroll: clampScroll(state.scroll - page) };
    if (key === 'home')
        return { ...state, scroll: Number.MAX_SAFE_INTEGER };
    if (key === 'end')
        return { ...state, scroll: 0 };
    return state;
}
function parseKeys(input) {
    const events = [];
    let index = 0;
    while (index < input.length) {
        if (input.startsWith(`${ESC}[`, index)) {
            const sequence = CSI_KEY.exec(input.slice(index));
            if (sequence) {
                const params = sequence[1] ?? '';
                const final = sequence[2] ?? '';
                const key = keyForSequence(params, final);
                if (key !== undefined)
                    events.push({ type: 'key', key });
                index += sequence[0].length;
                continue;
            }
        }
        const char = input.charAt(index);
        if (char === ESC) {
            events.push({ type: 'key', key: 'escape' });
            index += 1;
            continue;
        }
        if (char >= ' ')
            events.push({ type: 'key', key: char });
        index += 1;
    }
    return events;
}
