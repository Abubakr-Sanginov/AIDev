import type { NormalizedReply, NormalizedToolCall } from './tools.js';

export type AnthropicMessage = Record<string, unknown>;
export type AnthropicContentBlock = Record<string, unknown>;

export const ANTHROPIC_VERSION = '2023-06-01';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function errorMessage(response: Response): Promise<string> {
  const text = (await response.text()).slice(0, 500);
  return text === '' ? response.statusText : text;
}

function parseContent(content: unknown): { text: string; toolCalls: NormalizedToolCall[] } {
  if (typeof content === 'string') return { text: content, toolCalls: [] };
  if (!Array.isArray(content)) return { text: '', toolCalls: [] };
  const texts: string[] = [];
  const toolCalls: NormalizedToolCall[] = [];
  for (const [index, block] of content.entries()) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
    if (block.type === 'tool_use' && typeof block.name === 'string') {
      toolCalls.push({
        id: typeof block.id === 'string' && block.id !== '' ? block.id : `toolu_${index}`,
        name: block.name,
        argumentsJson: JSON.stringify(block.input === undefined ? {} : block.input),
      });
    }
  }
  return { text: texts.join('\n'), toolCalls };
}

/**
 * One round-trip against the Anthropic Messages API. The anthropic preset's
 * baseUrl intentionally has no version segment, so the client appends the
 * full `/v1/messages` path — see the convention note in catalog.ts.
 */
export async function callAnthropicMessages(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  messages: AnthropicMessage[];
  tools?: Record<string, unknown>[];
  fetchImpl?: typeof fetch;
}): Promise<{ reply: NormalizedReply; assistantContent: AnthropicContentBlock[] }> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const body: Record<string, unknown> = {
    model: options.model,
    max_tokens: 4096,
    messages: options.messages,
  };
  if (options.system !== '') body.system = options.system;
  if (options.tools && options.tools.length > 0) body.tools = options.tools;
  const response = await fetchImpl(`${options.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': options.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${await errorMessage(response)}`);
  const payload: unknown = await response.json();
  if (!isRecord(payload)) throw new Error('Anthropic provider returned an unexpected payload.');
  const parsed = parseContent(payload.content);
  const assistantContent: AnthropicContentBlock[] = Array.isArray(payload.content)
    ? payload.content.filter(isRecord)
    : [{ type: 'text', text: parsed.text }];
  return {
    reply: { text: parsed.text, toolCalls: parsed.toolCalls },
    assistantContent,
  };
}
