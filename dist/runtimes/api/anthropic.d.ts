import type { NormalizedReply } from './tools.js';
export type AnthropicMessage = Record<string, unknown>;
export type AnthropicContentBlock = Record<string, unknown>;
export declare const ANTHROPIC_VERSION = "2023-06-01";
/**
 * One round-trip against the Anthropic Messages API. The anthropic preset's
 * baseUrl intentionally has no version segment, so the client appends the
 * full `/v1/messages` path — see the convention note in catalog.ts.
 */
export declare function callAnthropicMessages(options: {
    baseUrl: string;
    apiKey: string;
    model: string;
    system: string;
    messages: AnthropicMessage[];
    tools?: Record<string, unknown>[];
    fetchImpl?: typeof fetch;
}): Promise<{
    reply: NormalizedReply;
    assistantContent: AnthropicContentBlock[];
}>;
