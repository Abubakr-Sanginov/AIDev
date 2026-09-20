import { type Rect } from './ascii.js';
export type MouseButton = 'left' | 'wheel-up' | 'wheel-down' | 'other';
export type TerminalEvent = {
    type: 'mouse';
    button: MouseButton;
    x: number;
    y: number;
} | {
    type: 'key';
    key: string;
};
/**
 * Parses a raw stdin chunk into terminal events. Supports SGR mouse reporting
 * (enabled with ?1006h), arrow keys, paging keys, and plain characters.
 */
export declare function parseTerminalInput(chunk: string): TerminalEvent[];
export type ViewKind = {
    kind: 'dashboard';
} | {
    kind: 'goal';
} | {
    kind: 'activity';
} | {
    kind: 'agent';
    roleId: string;
} | {
    kind: 'help';
};
export interface UiState {
    view: ViewKind;
    /** Lines scrolled up from the newest content. */
    scroll: number;
    /** Clickable regions of the currently painted dashboard frame. */
    hotspots: Rect[];
}
export declare const INITIAL_UI_STATE: UiState;
/** Pure reducer: maps one terminal event to the next UI state. */
export declare function reduceUiEvent(state: UiState, event: TerminalEvent, pageLines: number): UiState;
