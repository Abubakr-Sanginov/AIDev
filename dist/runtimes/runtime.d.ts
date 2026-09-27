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
    /**
     * Blocks while the user has paused the run. In-process runtimes call it
     * before every model request and tool call; CLI runtimes are frozen instead.
     */
    waitIfPaused?(): Promise<void>;
    /**
     * Aborted when the user hard-interrupts the run (the chat UI's Esc): in
     * -flight provider fetches abort instead of waiting for the next checkpoint.
     */
    signal?: AbortSignal;
}
export interface RuntimeModelDiscovery {
    models: string[];
    /** Model IDs that cost nothing to run (free tier); Auto mode prefers them. */
    freeModels?: string[];
    message?: string;
    /** Human-readable name per model id, shown in the chooser. */
    labels?: Record<string, string>;
    /**
     * The CLI accepts model ids beyond this list (full names, new releases),
     * so `--model` and the chooser must not reject an unlisted id.
     */
    allowCustom?: boolean;
    /**
     * Auto leaves the model to the CLI's own signed-in default instead of
     * rotating through the list: the list is a menu of choices, not a pool of
     * interchangeable providers (Claude Code, Codex).
     */
    autoUsesDefault?: boolean;
}
export interface RuntimeResult {
    success: boolean;
    output: string;
    sessionId?: string;
    exitCode?: number;
    /** Total prompt + completion tokens reported by the provider, when known. */
    tokensUsed?: number;
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
