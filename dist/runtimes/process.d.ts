export interface ProcessResult {
    code: number;
    stdout: string;
    stderr: string;
}
export interface ProcessActivity {
    type: 'started' | 'stdout' | 'stderr';
    text?: string;
    processId?: number;
}
export type ProcessActivityHandler = (activity: ProcessActivity) => Promise<void> | void;
export type ProcessRunner = (command: string, args: string[], cwd: string, timeoutMs?: number, onActivity?: ProcessActivityHandler, stdinText?: string) => Promise<ProcessResult>;
/**
 * Child CLIs normally write UTF-8, but Windows console programs emit localized
 * text in the OEM code page (CP866 on Russian systems). Decoding those bytes as
 * UTF-8 mangles them into U+FFFD/CJK garbage, so fall back to CP866 when UTF-8
 * clearly does not fit.
 */
export declare function decodeConsoleText(data: Buffer): string;
export declare function runProcess(command: string, args: string[], cwd: string, timeoutMs?: number, onActivity?: ProcessActivityHandler, stdinText?: string): Promise<ProcessResult>;
