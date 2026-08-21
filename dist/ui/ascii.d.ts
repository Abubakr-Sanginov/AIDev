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
export declare function panel(title: string, lines: string[], theme: Theme): string;
export declare function progressBar(completed: number, total: number, width?: number): string;
export declare function statusBadge(status: string, theme: Theme): string;
export declare const SPINNER_FRAMES: string[];
export declare function spinnerFrame(now?: number, intervalMs?: number): string;
export declare function formatDuration(milliseconds: number): string;
export declare function estimateEtaMs(completed: number, total: number, elapsedMs: number): number | undefined;
export interface DashboardOptions {
    verbose?: boolean;
    now?: number;
}
export declare function renderDashboard(state: RuntimeWorkflowState, root: string, theme: Theme, options?: DashboardOptions): string;
export declare function renderSummary(state: RuntimeWorkflowState, theme: Theme): string;
