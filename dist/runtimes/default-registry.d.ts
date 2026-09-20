import { RuntimeRegistry } from './registry.js';
export interface DefaultRegistryOptions {
    /** Project root; when set, stored API-key providers are registered too. */
    root?: string;
    /** Injected into API provider runtimes so tools can ask for approval. */
    approve?: (command: string) => Promise<boolean>;
}
export declare function createDefaultRegistry(options?: DefaultRegistryOptions): Promise<RuntimeRegistry>;
