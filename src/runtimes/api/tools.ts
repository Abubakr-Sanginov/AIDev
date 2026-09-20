import type { Tool } from '../../tools/index.js';
import type { ProviderProtocol } from '../../providers/catalog.js';

/**
 * Tools that mutate the project or the machine. They are removed from the
 * tool list when a request runs with toolPolicy 'read-only', so read-only
 * roles (manager, tester, reviewer) cannot change files even if the model
 * tries. The same list is enforced again when a call arrives.
 */
export const MUTATING_TOOL_NAMES: readonly string[] = [
  'write_file',
  'edit_file',
  'delete_file',
  'create_directory',
  'run_command',
];

export interface NormalizedToolCall {
  id: string;
  name: string;
  /** Raw JSON text of the arguments exactly as the provider sent it. */
  argumentsJson: string;
}

export interface NormalizedReply {
  text: string;
  toolCalls: NormalizedToolCall[];
}

export function isMutatingTool(name: string): boolean {
  return MUTATING_TOOL_NAMES.includes(name);
}

export function selectTools(
  tools: readonly Tool<unknown>[],
  toolPolicy?: 'read-only' | 'coding',
): Tool<unknown>[] {
  if (toolPolicy !== 'read-only') return [...tools];
  return tools.filter((tool) => !isMutatingTool(tool.definition.name));
}

/** OpenAI Chat Completions: [{type:'function', function:{name, description, parameters}}]. */
export function toOpenAiTools(tools: readonly Tool<unknown>[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.definition.name,
      description: tool.definition.description,
      parameters: { type: 'object', ...tool.definition.inputSchema },
    },
  }));
}

/** Anthropic Messages API: [{name, description, input_schema}]. */
export function toAnthropicTools(tools: readonly Tool<unknown>[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    name: tool.definition.name,
    description: tool.definition.description,
    input_schema: { type: 'object', ...tool.definition.inputSchema },
  }));
}

export function toolsForProtocol(
  protocol: ProviderProtocol,
  tools: readonly Tool<unknown>[],
): Record<string, unknown>[] {
  return protocol === 'openai' ? toOpenAiTools(tools) : toAnthropicTools(tools);
}
