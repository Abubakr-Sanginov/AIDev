import type { AgentRequest, AuthResult, CodingRuntime, InstallInstructions, InstallResult, LaunchOptions, RuntimeDetection, RuntimeResult, RuntimeSession, RuntimeState } from '../runtime.js';
export type MockBehavior = 'success' | 'failure' | 'timeout' | 'crash';
export interface MockResponse {
    behavior: MockBehavior;
    output?: string;
}
export declare class MockRuntime implements CodingRuntime {
    #private;
    readonly id = "mock";
    readonly name = "Mock Runtime";
    readonly sessions: Map<string, RuntimeSession>;
    constructor(responses?: MockResponse[]);
    detect(): Promise<RuntimeDetection>;
    getInstallInstructions(): InstallInstructions;
    install(): Promise<InstallResult>;
    authenticate(): Promise<AuthResult>;
    discoverModels(): Promise<{
        models: string[];
    }>;
    launch(options: LaunchOptions): Promise<RuntimeSession>;
    execute(session: RuntimeSession, _request: AgentRequest): Promise<RuntimeResult>;
    pause(session: RuntimeSession): Promise<void>;
    resume(session: RuntimeSession): Promise<void>;
    stop(session: RuntimeSession): Promise<void>;
    getStatus(session: RuntimeSession): Promise<RuntimeState>;
}
