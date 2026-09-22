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
    /** Why a finished workflow is FAILED when no individual agent failed. */
    failureReason?: string;
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
    /**
     * Opens the built site in a real browser after each tester pass. Returns
     * undefined when the project has nothing to open. A `fail` report carries a
     * `VERDICT: FAIL` line, so it routes to the fixer like any tester defect.
     */
    browserCheck?(onActivity: (message: string) => void): Promise<BrowserCheckOutcome | undefined>;
}
export interface BrowserCheckOutcome {
    status: 'pass' | 'fail' | 'skipped';
    report: string;
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
