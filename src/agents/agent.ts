import type { AgentResult, LLMProvider, Message, Role } from '../types.js';
import type { Tool, ToolContext } from '../tools/index.js';
import { executeTool } from '../tools/index.js';

export interface AgentOptions {
  role: Role;
  systemPrompt: string;
  provider: LLMProvider;
  tools: Tool<unknown>[];
  maxIterations?: number;
}

export class SharedLoopAgent {
  readonly role: Role;
  readonly #systemPrompt: string;
  readonly #provider: LLMProvider;
  readonly #tools: Map<string, Tool<unknown>>;
  readonly #maxIterations: number;

  constructor(options: AgentOptions) {
    this.role = options.role;
    this.#systemPrompt = options.systemPrompt;
    this.#provider = options.provider;
    this.#tools = new Map(options.tools.map((tool) => [tool.definition.name, tool]));
    this.#maxIterations = options.maxIterations ?? 30;
  }

  async run(task: string, context: ToolContext, relevantContext = ''): Promise<AgentResult> {
    const messages: Message[] = [
      { role: 'system', content: this.#systemPrompt },
      { role: 'user', content: `${task}\n\nRelevant context:\n${relevantContext || 'None'}` },
    ];
    const toolResults: AgentResult['toolResults'] = [];
    let output = '';
    for (let iteration = 1; iteration <= this.#maxIterations; iteration++) {
      const response = await this.#provider.generate(
        messages,
        [...this.#tools.values()].map((t) => t.definition),
      );
      output = response.content;
      messages.push({ role: 'assistant', content: response.content || '[tool calls]' });
      if (response.toolCalls.length === 0)
        return { role: this.role, output, toolResults, iterations: iteration };
      for (const call of response.toolCalls) {
        const tool = this.#tools.get(call.name);
        const result = tool
          ? await executeTool(tool, call.arguments, context)
          : { ok: false, tool: call.name, output: '', error: `Unknown tool: ${call.name}` };
        toolResults.push(result);
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify(result),
        });
      }
    }
    throw new Error(`${this.role} exceeded the maximum of ${this.#maxIterations} iterations.`);
  }
}
