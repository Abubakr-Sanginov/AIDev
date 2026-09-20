import type { NormalizedReply } from './tools.js';
export type OpenAiMessage = Record<string, unknown>;
export interface OpenAiChatOptions {
    fetchImpl?: typeof fetch;
}
/**
 * One round-trip against an OpenAI-compatible Chat Completions endpoint.
 * The baseUrl already contains the API version segment (e.g. /v1), so only
 * the endpoint suffix is appended — see the convention note in catalog.ts.
 */
export declare function callOpenAiChat(options: {
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: OpenAiMessage[];
    tools?: Record<string, unknown>[];
    fetchImpl?: typeof fetch;
}): Promise<{
    reply: NormalizedReply;
    assistantMessage: OpenAiMessage;
}>;
