import type { RuntimeWorkflowState } from '../runtimes/runtime-orchestrator.js';
import { type Theme } from './ascii.js';
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
/** Wraps plain text to a visible width, breaking long unspaced tokens. */
export declare function wrapText(text: string, width: number): string[];
/** Full goal text plus the run metadata, wrapped instead of truncated. */
export declare function renderGoalView(state: RuntimeWorkflowState, theme: Theme, viewport: Viewport, scroll: number): OverlayView;
/** Entire event history with timestamps, newest at the bottom. */
export declare function renderActivityView(state: RuntimeWorkflowState, theme: Theme, viewport: Viewport, scroll: number): OverlayView;
/** One role: every event it produced, its sessions, and its budget. */
export declare function renderAgentView(state: RuntimeWorkflowState, roleId: string, theme: Theme, viewport: Viewport, scroll: number): OverlayView;
/** Keyboard and mouse reference. */
export declare function renderHelpView(theme: Theme, viewport: Viewport): OverlayView;
