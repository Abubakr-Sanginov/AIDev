import type { CodingRuntime, RuntimeSession } from './runtime.js';
export interface RuntimeWorkflowEvent {
    roleId: string;
    status: 'RUNNING' | 'ACTIVE' | 'DONE' | 'FAILED';
    message: string;
    timestamp?: string;
}
export interface RuntimeWorkflowState {
    goal: string;
    runtimeId: string;
    status: 'RUNNING' | 'DONE' | 'FAILED';
    attempts: number;
    sessions: RuntimeSession[];
    events: RuntimeWorkflowEvent[];
    startedAt?: string;
    updatedAt?: string;
    completedPhases?: number;
    totalPhases?: number;
    currentRoleId?: string;
}
export interface RuntimeWorkflowOptions {
    root: string;
    runtime: CodingRuntime;
    maxFixAttempts?: number;
    visibleRuntime?: boolean;
    heartbeatMs?: number;
    model?: string;
    onState?(state: RuntimeWorkflowState): Promise<void> | void;
}
export declare function workflowProgress(state: RuntimeWorkflowState): {
    completed: number;
    total: number;
};
export declare class RuntimeOrchestrator {
    #private;
    constructor(options: RuntimeWorkflowOptions);
    run(goal: string): Promise<RuntimeWorkflowState>;
}
