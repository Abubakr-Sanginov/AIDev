import { type ProviderProtocol } from './catalog.js';
export { maskKey } from './mask.js';
export interface StoredProvider {
    id: string;
    name: string;
    protocol: ProviderProtocol;
    baseUrl: string;
    models: string[];
    apiKeyEnv?: string;
    preset?: string;
}
export interface ProviderView extends StoredProvider {
    keySource: 'env' | 'stored' | 'missing';
    maskedKey?: string;
}
export type KeyResolution = {
    ok: true;
    key: string;
    source: 'env' | 'stored';
} | {
    ok: false;
    reason: 'missing' | 'invalid';
};
/**
 * Providers, their model lists and API keys belong to the user, not to one
 * project: a provider added once must be available in every project. They
 * live in ~/.ai-dev-team (AI_DEV_TEAM_HOME overrides it, e.g. for tests).
 */
export declare function globalHome(): string;
export declare function providersFilePath(): string;
export declare function secretsFilePath(): string;
export declare function listProviders(root: string): Promise<StoredProvider[]>;
export declare function getProvider(root: string, id: string): Promise<StoredProvider | undefined>;
export declare function addPreset(root: string, presetId: string, key?: string): Promise<StoredProvider>;
export declare function addCustom(root: string, definition: {
    id: string;
    name: string;
    protocol: string;
    baseUrl: string;
    models: string[];
    apiKeyEnv?: string;
}, key?: string): Promise<StoredProvider>;
export declare function removeProvider(root: string, id: string): Promise<void>;
export declare function setKey(root: string, id: string, key: string): Promise<void>;
export declare function resolveKey(root: string, id: string): Promise<KeyResolution>;
export declare function providersView(root: string): Promise<ProviderView[]>;
export declare function testProvider(root: string, id: string, fetchImpl?: typeof fetch): Promise<{
    ok: boolean;
    message: string;
}>;
