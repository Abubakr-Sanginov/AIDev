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
export declare const THEME_NAMES: readonly ThemeName[];
export declare function resolveTheme(name?: string): Theme;
export declare const BANNER_LINES: string[];
export declare function renderBanner(theme: Theme, version: string): string;
export declare function visibleWidth(text: string): number;
/** Truncates a string to a visible width without breaking ANSI color sequences. */
export declare function truncateVisible(text: string, width: number): string;
export declare function panel(title: string, lines: string[], theme: Theme, maxWidth?: number): string;
export declare function progressBar(completed: number, total: number, width?: number): string;
export declare function statusBadge(status: string, theme: Theme): string;
export declare const SPINNER_FRAMES: string[];
export declare function spinnerFrame(now?: number, intervalMs?: number): string;
export declare function formatDuration(milliseconds: number): string;
export declare function estimateEtaMs(completed: number, total: number, elapsedMs: number): number | undefined;
/** Clickable screen region, 1-based, inclusive. */
export interface Rect {
    id: string;
    top: number;
    left: number;
    bottom: number;
    right: number;
}
/** Returns the id of the innermost region containing the point, if any. */
export declare function hitTest(rects: readonly Rect[], x: number, y: number): string | undefined;
export interface DashboardOptions {
    verbose?: boolean;
    now?: number;
    maxWidth?: number;
    /** Filled with clickable regions while the dashboard is rendered. */
    hotspots?: Rect[];
    /** Screen lines already printed above the dashboard (banner height). */
    offsetY?: number;
}
export declare function renderDashboard(state: RuntimeWorkflowState, root: string, theme: Theme, options?: DashboardOptions): string;
export declare function renderSummary(state: RuntimeWorkflowState, theme: Theme, maxWidth?: number): string;
