import type { NormalizedReply } from './tools.js';
export type OpenAiMessage = Record<string, unknown>;
export interface OpenAiChatOptions {
    fetchImpl?: typeof fetch;
}
/**
 * POSTs JSON with a small transport-level retry: transient network failures
 * (Wi-Fi drop, provider restart, kept-alive socket closed) should not cost a
 * whole stage retry, which would resend the entire conversation. Only thrown
 * fetch errors retry; HTTP error statuses are returned to the caller.
 */
export declare function postJson(options: {
    fetchImpl: typeof fetch;
    url: string;
    headers: Record<string, string>;
    body: string;
    delaysMs?: readonly number[];
    timeoutMs?: number;
    /** Hard-interrupt signal: when aborted, the request fails immediately and is never retried. */
    signal?: AbortSignal;
}): Promise<Response>;
/** Input and output token counts as reported by a provider response. */
export interface ProviderTokenUsage {
    input: number;
    output: number;
}
export declare function parseOpenAiUsage(payload: Record<string, unknown>): ProviderTokenUsage | undefined;
export declare function parseAnthropicUsage(payload: Record<string, unknown>): ProviderTokenUsage | undefined;
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
    transportDelaysMs?: readonly number[];
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<{
    reply: NormalizedReply;
    assistantMessage: OpenAiMessage;
    tokens?: ProviderTokenUsage;
}>;
