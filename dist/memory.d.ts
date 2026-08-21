import type { ProjectState, Role } from './types.js';
export declare class ProjectMemory {
    #private;
    readonly directory: string;
    constructor(root: string);
    initialize(goal?: string): Promise<ProjectState>;
    loadState(): Promise<ProjectState | undefined>;
    saveState(state: ProjectState): Promise<void>;
    savePlan(tasks: ProjectState['tasks']): Promise<void>;
    recordAgent(role: Role, output: string): Promise<void>;
    appendErrors(report: string): Promise<void>;
    contextFor(role: Role, state: ProjectState): Promise<string>;
}
