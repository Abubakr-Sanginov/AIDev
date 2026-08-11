import type { LLMProvider, LLMResponse, Message, ToolDefinition } from '../types.js';

export type MockStep =
  LLMResponse | ((messages: Message[], tools: ToolDefinition[]) => LLMResponse);

export class MockProvider implements LLMProvider {
  readonly #steps: MockStep[];
  #index = 0;

  constructor(steps: MockStep[]) {
    this.#steps = steps;
  }

  async generate(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const step = this.#steps[this.#index++];
    if (!step) return { content: 'Mock sequence complete.', toolCalls: [] };
    return typeof step === 'function' ? step(messages, tools) : step;
  }

  get calls(): number {
    return this.#index;
  }
}
