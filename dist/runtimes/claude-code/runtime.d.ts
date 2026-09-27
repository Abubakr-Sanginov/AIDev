import type { AgentRequest, AuthResult, CodingRuntime, InstallInstructions, InstallResult, LaunchOptions, RuntimeDetection, RuntimeModelDiscovery, RuntimeResult, RuntimeSession, RuntimeState } from '../runtime.js';
import { type ProcessRunner } from '../process.js';
/** Aliases `claude --model` resolves to the newest model of each family. */
export declare const CLAUDE_MODEL_ALIASES: ReadonlyArray<{
    id: string;
    label: string;
}>;
import type { TerminalLauncher } from '../../terminal/terminal.js';
export declare class ClaudeCodeRuntime implements CodingRuntime {
    #private;
    readonly id = "claude";
    readonly name = "Claude Code";
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
