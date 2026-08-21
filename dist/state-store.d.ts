import { type DurableWriteOptions } from './durable-file.js';
import type { RuntimeWorkflowState } from './runtimes/runtime-orchestrator.js';
export declare class StateStore {
    #private;
    readonly directory: string;
    constructor(root: string, writeOptions?: DurableWriteOptions);
    initialize(): Promise<void>;
    save(state: RuntimeWorkflowState): Promise<void>;
    load(): Promise<RuntimeWorkflowState | undefined>;
}
