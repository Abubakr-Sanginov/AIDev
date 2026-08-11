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

export async function executeTool<T>(
  tool: Tool<T>,
  input: unknown,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, tool: tool.definition.name, output: '', error: parsed.error.message };
  }
  try {
    return {
      ok: true,
      tool: tool.definition.name,
      output: await tool.execute(parsed.data, context),
    };
  } catch (error) {
    return {
      ok: false,
      tool: tool.definition.name,
      output: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
