import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMResponse, Message, ToolDefinition } from '../types.js';

export interface AnthropicProviderOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

export class AnthropicProvider implements LLMProvider {
  readonly #client: Anthropic;
  readonly #model: string;
  readonly #maxTokens: number;

  constructor(options: AnthropicProviderOptions = {}) {
    this.#client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    this.#model = options.model ?? 'claude-3-7-sonnet-latest';
    this.#maxTokens = options.maxTokens ?? 4096;
  }

  async generate(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const conversation = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content:
          m.role === 'tool'
            ? `Tool result (${m.toolCallId ?? 'unknown'}):\n${m.content}`
            : m.content,
      }));
    const response = await this.#client.messages.create({
      model: this.#model,
      max_tokens: this.#maxTokens,
      system,
      messages: conversation.length > 0 ? conversation : [{ role: 'user', content: 'Begin.' }],
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: { type: 'object' as const, ...tool.inputSchema },
      })),
    });
    return {
      content: response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n'),
      toolCalls: response.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({
          id: b.id,
          name: b.name,
          arguments: b.input,
        })),
    };
  }
}
