import type { AgentResult, LLMProvider, Role } from '../types.js';
import type { Tool, ToolContext } from '../tools/index.js';
export interface AgentOptions {
    role: Role;
    systemPrompt: string;
    provider: LLMProvider;
    tools: Tool<unknown>[];
    maxIterations?: number;
}
export declare class SharedLoopAgent {
    #private;
    readonly role: Role;
    constructor(options: AgentOptions);
    run(task: string, context: ToolContext, relevantContext?: string): Promise<AgentResult>;
}
