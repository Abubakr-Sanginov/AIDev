import { RuntimeRegistry } from './registry.js';
import { ClaudeCodeRuntime } from './claude-code/runtime.js';
import { OpenCodeRuntime } from './opencode/runtime.js';
import { MockRuntime } from './mock/runtime.js';
import { CodexRuntime } from './codex/runtime.js';
import { SystemTerminalLauncher } from '../terminal/system-launcher.js';
export function createDefaultRegistry() {
    const registry = new RuntimeRegistry();
    registry.register(new ClaudeCodeRuntime(new SystemTerminalLauncher()));
    registry.register(new OpenCodeRuntime(new SystemTerminalLauncher()));
    registry.register(new CodexRuntime(new SystemTerminalLauncher()));
    registry.register(new MockRuntime());
    return registry;
}
