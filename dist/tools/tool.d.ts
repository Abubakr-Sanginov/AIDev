import type { ZodType, ZodTypeDef } from 'zod';
import type { ToolDefinition, ToolExecutionResult } from '../types.js';
export interface ToolContext {
    root: string;
    approve(command: string): Promise<boolean>;
}
export interface Tool<T> {
    definition: ToolDefinition;
    schema: ZodType<T, ZodTypeDef, unknown>;
    execute(input: T, context: ToolContext): Promise<string>;
}
export declare function executeTool<T>(tool: Tool<T>, input: unknown, context: ToolContext): Promise<ToolExecutionResult>;
