import type { TerminalLauncher } from '../../terminal/terminal.js';
import { type ProcessRunner } from '../process.js';
import type { AgentRequest, AuthResult, CodingRuntime, InstallInstructions, InstallResult, LaunchOptions, RuntimeDetection, RuntimeModelDiscovery, RuntimeResult, RuntimeSession, RuntimeState } from '../runtime.js';
/**
 * Reads the model list the Codex CLI caches for the signed-in account
 * (`$CODEX_HOME/models_cache.json`), in the order Codex itself shows it:
 * hidden entries dropped, lower `priority` first.
 */
export declare function parseCodexModelsCache(raw: string): Array<{
    id: string;
    label: string;
}>;
export declare function codexHome(): string;
export declare function buildCodexExecArgs(request: AgentRequest): string[];
export declare function parseCodexJsonEvents(stdout: string): {
    output: string;
    sessionId?: string;
};
export declare class CodexRuntime implements CodingRuntime {
    #private;
    readonly id = "codex";
    readonly name = "Codex CLI";
    constructor(terminal: TerminalLauncher, processRunner?: ProcessRunner);
    detect(): Promise<RuntimeDetection>;
    getInstallInstructions(): InstallInstructions;
    install(): Promise<InstallResult>;
    authenticate(workingDirectory: string): Promise<AuthResult>;
    discoverModels(): Promise<RuntimeModelDiscovery>;
    launch(options: LaunchOptions): Promise<RuntimeSession>;
    execute(session: RuntimeSession, request: AgentRequest): Promise<RuntimeResult>;
    pause(session: RuntimeSession): Promise<void>;
    resume(session: RuntimeSession): Promise<void>;
    stop(session: RuntimeSession): Promise<void>;
    getStatus(session: RuntimeSession): Promise<RuntimeState>;
}
