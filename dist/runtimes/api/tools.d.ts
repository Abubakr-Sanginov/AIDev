import type { Tool } from '../../tools/index.js';
import type { ProviderProtocol } from '../../providers/catalog.js';
/**
 * Tools that mutate the project or the machine. They are removed from the
 * tool list when a request runs with toolPolicy 'read-only', so read-only
 * roles (manager, tester, reviewer) cannot change files even if the model
 * tries. The same list is enforced again when a call arrives.
 */
export declare const MUTATING_TOOL_NAMES: readonly string[];
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
export declare function isMutatingTool(name: string): boolean;
export declare function selectTools(tools: readonly Tool<unknown>[], toolPolicy?: 'read-only' | 'coding'): Tool<unknown>[];
/** OpenAI Chat Completions: [{type:'function', function:{name, description, parameters}}]. */
export declare function toOpenAiTools(tools: readonly Tool<unknown>[]): Record<string, unknown>[];
/** Anthropic Messages API: [{name, description, input_schema}]. */
export declare function toAnthropicTools(tools: readonly Tool<unknown>[]): Record<string, unknown>[];
export declare function toolsForProtocol(protocol: ProviderProtocol, tools: readonly Tool<unknown>[]): Record<string, unknown>[];
