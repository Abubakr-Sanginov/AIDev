import type { LLMProvider, LLMResponse, Message, ToolDefinition } from '../types.js';
export interface AnthropicProviderOptions {
    apiKey?: string;
    model?: string;
    maxTokens?: number;
}
export declare class AnthropicProvider implements LLMProvider {
    #private;
    constructor(options?: AnthropicProviderOptions);
    generate(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse>;
}
