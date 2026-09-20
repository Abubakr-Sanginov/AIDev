import type { StoredProvider } from '../../providers/store.js';
import type { AgentRequest, AuthResult, CodingRuntime, InstallInstructions, InstallResult, LaunchOptions, RuntimeDetection, RuntimeModelDiscovery, RuntimeResult, RuntimeSession, RuntimeState } from '../runtime.js';
export interface ApiRuntimeOptions {
    root: string;
    approve?: (command: string) => Promise<boolean>;
    fetchImpl?: typeof fetch;
    /** Backoff between transport-level retries for transient network errors. */
    transportDelaysMs?: readonly number[];
}
/**
 * CodingRuntime backed by a stored provider definition (see providers/store).
 * It speaks either the OpenAI-compatible Chat Completions protocol or the
 * Anthropic Messages API over plain fetch — no vendor SDKs — and drives the
 * shared tool set from src/tools so API providers get the same sandboxing,
 * approval flow, and read-only policy as the CLI runtimes.
 */
export declare class ApiProviderRuntime implements CodingRuntime {
    #private;
    readonly id: string;
    readonly name: string;
    constructor(provider: StoredProvider, options: ApiRuntimeOptions);
    detect(): Promise<RuntimeDetection>;
    getInstallInstructions(): InstallInstructions;
    install(): Promise<InstallResult>;
    authenticate(workingDirectory: string): Promise<AuthResult>;
    discoverModels(): Promise<RuntimeModelDiscovery>;
    launch(options: LaunchOptions): Promise<RuntimeSession>;
    pause(session: RuntimeSession): Promise<void>;
    resume(session: RuntimeSession): Promise<void>;
    stop(session: RuntimeSession): Promise<void>;
    getStatus(session: RuntimeSession): Promise<RuntimeState>;
    execute(session: RuntimeSession, request: AgentRequest): Promise<RuntimeResult>;
}
