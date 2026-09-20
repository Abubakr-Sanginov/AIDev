import { RuntimeRegistry } from './registry.js';
import { ClaudeCodeRuntime } from './claude-code/runtime.js';
import { OpenCodeRuntime } from './opencode/runtime.js';
import { MockRuntime } from './mock/runtime.js';
import { CodexRuntime } from './codex/runtime.js';
import { SystemTerminalLauncher } from '../terminal/system-launcher.js';
import { listProviders, type StoredProvider } from '../providers/store.js';
import { ApiProviderRuntime } from './api/runtime.js';

export interface DefaultRegistryOptions {
  /** Project root; when set, stored API-key providers are registered too. */
  root?: string;
  /** Injected into API provider runtimes so tools can ask for approval. */
  approve?: (command: string) => Promise<boolean>;
}

export async function createDefaultRegistry(
  options: DefaultRegistryOptions = {},
): Promise<RuntimeRegistry> {
  const registry = new RuntimeRegistry();
  registry.register(new ClaudeCodeRuntime(new SystemTerminalLauncher()));
  registry.register(new OpenCodeRuntime(new SystemTerminalLauncher()));
  registry.register(new CodexRuntime(new SystemTerminalLauncher()));
  registry.register(new MockRuntime());
  if (options.root !== undefined) {
    let providers: StoredProvider[] = [];
    try {
      providers = await listProviders(options.root);
    } catch {
      // A corrupt providers.json must not break the built-in runtimes.
    }
    for (const provider of providers)
      registry.register(
        new ApiProviderRuntime(provider, {
          root: options.root,
          ...(options.approve === undefined ? {} : { approve: options.approve }),
        }),
      );
  }
  return registry;
}

