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
export type ProcessRunner = (command: string, args: string[], cwd: string, timeoutMs?: number, onActivity?: ProcessActivityHandler) => Promise<ProcessResult>;
export declare function runProcess(command: string, args: string[], cwd: string, timeoutMs?: number, onActivity?: ProcessActivityHandler): Promise<ProcessResult>;
