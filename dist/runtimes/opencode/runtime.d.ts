import type { TerminalLauncher } from '../../terminal/terminal.js';
import { type ProcessRunner } from '../process.js';
import type { AgentRequest, AuthResult, CodingRuntime, InstallInstructions, InstallResult, LaunchOptions, RuntimeDetection, RuntimeResult, RuntimeSession, RuntimeState } from '../runtime.js';
export interface OpenCodeJsonResult {
    output: string;
    sessionId?: string;
}
export declare function parseOpenCodeJsonEvents(stdout: string): OpenCodeJsonResult;
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
    discoverModels(workingDirectory: string): Promise<{
        models: string[];
        message?: string;
    }>;
    launch(options: LaunchOptions): Promise<RuntimeSession>;
    execute(session: RuntimeSession, request: AgentRequest): Promise<RuntimeResult>;
    pause(session: RuntimeSession): Promise<void>;
    resume(session: RuntimeSession): Promise<void>;
    stop(session: RuntimeSession): Promise<void>;
    getStatus(session: RuntimeSession): Promise<RuntimeState>;
}
