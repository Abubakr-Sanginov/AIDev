export interface BrowserCheckOptions {
    root: string;
    /** Show the browser window so the user can watch it click through the site. */
    headed: boolean;
    onActivity?: (message: string) => void;
    serverTimeoutMs?: number;
    /** Upper bound for the whole exploration once the page is open. */
    explorationTimeoutMs?: number;
    maxClicks?: number;
}
export interface BrowserCheckResult {
    status: 'pass' | 'fail' | 'skipped';
    report: string;
}
/**
 * Serves the site the agents built, opens it in a real browser, scrolls,
 * clicks and types like a first-time visitor, and reports runtime defects
 * (uncaught exceptions, console errors, failing requests, blank page).
 * Deterministic and model-free, so it costs no tokens.
 */
export declare function runBrowserCheck(options: BrowserCheckOptions): Promise<BrowserCheckResult | undefined>;
