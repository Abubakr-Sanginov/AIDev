import type { LLMProvider, LLMResponse, Message, ToolDefinition } from '../types.js';
export type MockStep = LLMResponse | ((messages: Message[], tools: ToolDefinition[]) => LLMResponse);
export declare class MockProvider implements LLMProvider {
    #private;
    constructor(steps: MockStep[]);
    generate(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse>;
    get calls(): number;
}
