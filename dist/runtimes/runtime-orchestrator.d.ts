import type { CodingRuntime, RuntimeSession } from './runtime.js';
import { type ProjectContext } from '../project-context.js';
export type RuntimeWorkflowEventStatus = 'RUNNING' | 'ACTIVE' | 'RETRYING' | 'DONE' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
export interface RuntimeWorkflowEvent {
    roleId: string;
    status: RuntimeWorkflowEventStatus;
    message: string;
    timestamp?: string;
    attempt?: number;
    maxAttempts?: number;
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
    /** Model currently serving the workflow (Auto rotation keeps it current). */
    model?: string;
    projectContext?: ProjectContext;
}
export interface RuntimeWorkflowOptions {
    root: string;
    runtime: CodingRuntime;
    maxFixAttempts?: number;
    visibleRuntime?: boolean;
    heartbeatMs?: number;
    /** Pin every stage to this exact model. */
    model?: string;
    /**
     * Ordered Auto-mode candidates: the workflow starts with the first and
     * rotates to the next whenever the active model fails fatally (quota,
     * billing, authentication). Free models belong at the front of the list.
     */
    models?: string[];
    maxAgentAttempts?: number;
    retryBackoffMs?: number;
    onState?(state: RuntimeWorkflowState): Promise<void> | void;
    onStateError?(error: unknown): Promise<void> | void;
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
