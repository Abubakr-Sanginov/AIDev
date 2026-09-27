import type { RuntimeWorkflowEvent, RuntimeWorkflowState } from '../runtimes/runtime-orchestrator.js';
import { type Theme } from './ascii.js';
export interface ChatHeaderInfo {
    version: string;
    runtimeName: string;
    modelLabel: string;
    root: string;
}
export declare function renderChatHeader(theme: Theme, info: ChatHeaderInfo): string;
export declare function roleDisplayName(roleId: string): string;
/** 850 → '850', 54_800 → '54.8k', 1_250_000 → '1.25M'. */
export declare function formatTokens(count: number): string;
export declare function wordWrap(text: string, width: number): string[];
export interface RoleBlockInfo {
    roleId: string;
    text: string;
    /** ISO timestamp of the role's RUNNING event, for the elapsed meta line. */
    startedAt?: string | undefined;
    /** ISO timestamp of the role's DONE event. */
    finishedAt?: string | undefined;
    toolCalls: number;
    maxTextLines?: number | undefined;
    /** Omit when the running header was already printed when the role started. */
    includeHeader?: boolean | undefined;
}
export declare const MAX_ROLE_TEXT_LINES = 100;
/** The complete message block for one finished agent: header, text, meta line. */
export declare function renderRoleBlock(theme: Theme, info: RoleBlockInfo, width: number): string;
/**
 * One scrollback line for a non-role event (retry, skip, cancel, browser
 * progress). Returns undefined for noise that must not be printed.
 */
export declare function renderEventLine(theme: Theme, event: RuntimeWorkflowEvent, width: number): string | undefined;
/** Final one-line verdict for a finished run, like `(14m 25s · ↑ 54.8k tokens)`. */
export declare function renderRunSummary(theme: Theme, state: RuntimeWorkflowState, now: number): string;
export interface StatusLineOptions {
    state: RuntimeWorkflowState;
    frame?: string | undefined;
    now?: number | undefined;
    /** Latest activity headline from the working role. */
    activity?: string | undefined;
    /** A task typed while the team works, waiting to start next. */
    queued?: string | undefined;
}
/** The live spinner row shown above the input box while the team works. */
export declare function renderStatusLine(theme: Theme, options: StatusLineOptions): string;
export type ChatKeyEvent = {
    type: 'char';
    text: string;
} | {
    type: 'enter';
} | {
    type: 'backspace';
} | {
    type: 'escape';
} | {
    type: 'up';
} | {
    type: 'down';
} | {
    type: 'ctrl-c';
} | {
    type: 'ctrl-u';
} | {
    type: 'ctrl-p';
};
/**
 * Parses a raw stdin chunk into chat input events: printable runs (including
 * Cyrillic), Enter, Backspace, Esc, arrows, and the control keys the chat view
 * binds (ctrl+c exit, ctrl+p pause, ctrl+u clear line).
 */
export declare function parseChatKeys(chunk: string): ChatKeyEvent[];
/**
 * Turns new workflow events into scrollback lines. Stateful only in the
 * "already rendered" cursor and per-role counters; no terminal I/O.
 */
export declare class ChatRenderer {
    #private;
    constructor(theme: Theme);
    get latestActivity(): string | undefined;
    consume(state: RuntimeWorkflowState, width: number): {
        lines: string[];
        activity?: string;
    };
}
