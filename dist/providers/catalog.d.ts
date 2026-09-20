/**
 * Built-in provider catalog. Every preset describes how to reach one hosted LLM
 * API: `openai` speaks OpenAI-compatible Chat Completions, `anthropic` speaks
 * the Messages API. Model lists are static defaults used for model discovery and
 * the interactive chooser; they can be extended with a custom provider entry.
 *
 * baseUrl convention: each preset carries the FULL API base path and clients
 * append only the endpoint suffix. OpenAI-compatible presets include the `/v1`
 * (or vendor equivalent) segment, so the client appends `/chat/completions`.
 * The Anthropic preset intentionally omits `/v1`, so the client appends
 * `/v1/messages`. Never append an extra version segment in client code, or you
 * end up with `//v1/v1/messages`.
 */
export type ProviderProtocol = 'openai' | 'anthropic';
export interface ProviderPreset {
    id: string;
    name: string;
    protocol: ProviderProtocol;
    baseUrl: string;
    /** Environment variable that wins over any key saved in secrets.json. */
    apiKeyEnv: string;
    models: string[];
    /** Zero-cost models; Auto mode rotates through them before paid ones. */
    freeModels?: string[];
}
export declare const PROVIDER_PROTOCOLS: readonly ProviderProtocol[];
/** IDs reserved by the runtimes that ship with the CLI (see createDefaultRegistry). */
export declare const RESERVED_PROVIDER_IDS: readonly string[];
export declare const providerPresets: readonly ProviderPreset[];
export declare function findPreset(id: string): ProviderPreset | undefined;
export declare function isProviderProtocol(value: string): value is ProviderProtocol;
