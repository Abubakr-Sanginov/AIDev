import type { RuntimeWorkflowState } from './runtimes/runtime-orchestrator.js';
export declare function buildReport(state: RuntimeWorkflowState): string;
export declare function writeReport(root: string, state: RuntimeWorkflowState): Promise<string>;
