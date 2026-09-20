import type { NormalizedReply, NormalizedToolCall } from './tools.js';

export type OpenAiMessage = Record<string, unknown>;

export interface OpenAiChatOptions {
  fetchImpl?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Extracts the provider's error text from a non-2xx body without leaking headers. */
async function errorMessage(response: Response): Promise<string> {
  const text = (await response.text()).slice(0, 500);
  return text === '' ? response.statusText : text;
}

function parseToolCalls(message: Record<string, unknown>): NormalizedToolCall[] {
  const raw = message.tool_calls;
  if (!Array.isArray(raw)) return [];
  const calls: NormalizedToolCall[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!isRecord(entry) || !isRecord(entry.function)) continue;
    const name = entry.function.name;
    if (typeof name !== 'string' || name === '') continue;
    const args = entry.function.arguments;
    calls.push({
      id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : `call_${index}`,
      name,
      argumentsJson:
        typeof args === 'string' ? args : JSON.stringify(args === undefined ? {} : args),
    });
  }
  return calls;
}

/**
 * One round-trip against an OpenAI-compatible Chat Completions endpoint.
 * The baseUrl already contains the API version segment (e.g. /v1), so only
 * the endpoint suffix is appended — see the convention note in catalog.ts.
 */
export async function callOpenAiChat(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: OpenAiMessage[];
  tools?: Record<string, unknown>[];
  fetchImpl?: typeof fetch;
}): Promise<{ reply: NormalizedReply; assistantMessage: OpenAiMessage }> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
  };
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = 'auto';
  }
  const response = await fetchImpl(`${options.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${await errorMessage(response)}`);
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.choices))
    throw new Error('OpenAI-compatible provider returned an unexpected payload.');
  const first: unknown = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.message))
    throw new Error('OpenAI-compatible provider returned no choices.');
  const message = first.message;
  const text = typeof message.content === 'string' ? message.content : '';
  return {
    reply: { text, toolCalls: parseToolCalls(message) },
    assistantMessage: message,
  };
}
