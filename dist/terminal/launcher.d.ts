import type { TerminalLauncher, TerminalOptions, TerminalProcess } from './terminal.js';
export declare function buildWindowsTerminalArgs(options: TerminalOptions): string[];
export declare class SystemTerminalLauncher implements TerminalLauncher {
    open(options: TerminalOptions): Promise<TerminalProcess>;
}
