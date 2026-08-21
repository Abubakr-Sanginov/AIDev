export type RuntimeState = 'starting' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
export interface RuntimeDetection {
    installed: boolean;
    ready: boolean;
    authenticated: 'yes' | 'no' | 'unknown';
    version?: string;
    message?: string;
}
export interface InstallInstructions {
    command: string;
    description: string;
    officialUrl: string;
}
export interface InstallResult {
    success: boolean;
    message: string;
}
export interface AuthResult {
    success: boolean;
    message: string;
}
export interface LaunchOptions {
    workingDirectory: string;
    roleId: string;
    visible?: boolean;
}
export interface RuntimeActivity {
    type: 'child-started' | 'output';
    message: string;
    processId?: number;
}
export interface AgentRequest {
    prompt: string;
    resumeSessionId?: string;
    model?: string;
    maxSteps?: number;
    maxToolCalls?: number;
    toolPolicy?: 'read-only' | 'coding';
    onActivity?(activity: RuntimeActivity): Promise<void> | void;
}
export interface RuntimeModelDiscovery {
    models: string[];
    message?: string;
}
export interface RuntimeResult {
    success: boolean;
    output: string;
    sessionId?: string;
    exitCode?: number;
}
export interface RuntimeSession {
    id: string;
    runtimeId: string;
    roleId: string;
    workingDirectory: string;
    status: RuntimeState;
    createdAt: string;
    processId?: number;
    outputFile?: string;
    terminalOpened?: boolean;
    terminalError?: string;
}
export interface CodingRuntime {
    readonly id: string;
    readonly name: string;
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
