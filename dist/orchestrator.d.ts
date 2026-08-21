import type { LLMProvider, ProjectState } from './types.js';
import type { UI } from './ui.js';
export interface OrchestratorOptions {
    root: string;
    provider: LLMProvider;
    ui: UI;
    approve(command: string): Promise<boolean>;
    maxFixAttempts?: number;
}
export declare class Orchestrator {
    #private;
    constructor(options: OrchestratorOptions);
    run(goal: string): Promise<ProjectState>;
}
