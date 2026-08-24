import type { TerminalLauncher } from '../../terminal/terminal.js';
import { type ProcessResult, type ProcessRunner } from '../process.js';
import type { AgentRequest, AuthResult, CodingRuntime, InstallInstructions, InstallResult, LaunchOptions, RuntimeDetection, RuntimeModelDiscovery, RuntimeResult, RuntimeSession, RuntimeState } from '../runtime.js';
export interface OpenCodeJsonResult {
    output: string;
    sessionId?: string;
}
/** Builds a readable failure message from an OpenCode JSON event stream. */
export declare function summarizeOpenCodeFailure(result: ProcessResult): string;
/**
 * Formats one streamed output line for the human-readable session log shown in
 * the separate runtime window. JSON events become `[HH:MM:SS] type: detail`;
 * anything else is kept verbatim so diagnostics are never lost.
 */
export declare function formatOpenCodeLogLine(line: string, prefix?: string, now?: Date): string | undefined;
export declare function parseOpenCodeJsonEvents(stdout: string): OpenCodeJsonResult;
export interface OpenCodeModelInfo {
    id: string;
    free: boolean;
}
/**
 * Parses `opencode models --verbose` output: each model is a `provider/id`
 * header line followed by a pretty-printed JSON metadata block whose `cost`
 * fields reveal whether the model runs for free.
 */
export declare function parseOpenCodeVerboseModels(stdout: string): OpenCodeModelInfo[];
export declare function buildOpenCodeRunArgs(request: AgentRequest): string[];
export declare class OpenCodeRuntime implements CodingRuntime {
    #private;
    readonly id = "opencode";
    readonly name = "OpenCode";
    constructor(terminal: TerminalLauncher, processRunner?: ProcessRunner);
    detect(): Promise<RuntimeDetection>;
    getInstallInstructions(): InstallInstructions;
    install(): Promise<InstallResult>;
    authenticate(workingDirectory: string): Promise<AuthResult>;
    discoverModels(workingDirectory: string): Promise<RuntimeModelDiscovery>;
    launch(options: LaunchOptions): Promise<RuntimeSession>;
    execute(session: RuntimeSession, request: AgentRequest): Promise<RuntimeResult>;
    pause(session: RuntimeSession): Promise<void>;
    resume(session: RuntimeSession): Promise<void>;
    stop(session: RuntimeSession): Promise<void>;
    getStatus(session: RuntimeSession): Promise<RuntimeState>;
}
