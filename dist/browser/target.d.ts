/** How the finished site can be served for a browser check. */
export type WebTarget = {
    kind: 'script';
    packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun';
    script: string;
    command: string;
    /** Extra environment for the server process (e.g. HOST for CRA). */
    env: Record<string, string>;
    /** No node_modules yet: the dev server cannot start. */
    needsInstall: boolean;
} | {
    kind: 'static';
    directory: string;
};
/** Returns undefined when the project has nothing a browser could open. */
export declare function detectWebTarget(root: string): Promise<WebTarget | undefined>;
/** Finds the address a dev server announces ("Local: http://localhost:4321/"). */
export declare function findLocalUrl(output: string): string | undefined;
export interface BrowserFindings {
    url: string;
    browser: string;
    headed: boolean;
    screens: number;
    interactive: number;
    clicked: number;
    typed: number;
    defects: string[];
    notes: string[];
    screenshots: string[];
}
/**
 * A failing check carries a real `VERDICT: FAIL` line so the tester gate routes
 * it to the fixer. A passing one deliberately does not say `VERDICT: PASS`:
 * appended to a tester artifact, that would mask the tester's own findings.
 */
export declare function formatBrowserReport(findings: BrowserFindings): string;
/** A failure before any page could be inspected (no install, server crash). */
export declare function formatBrowserFailure(reason: string): string;
