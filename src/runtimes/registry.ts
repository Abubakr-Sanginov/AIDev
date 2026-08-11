import type { CodingRuntime } from './runtime.js';

export class RuntimeRegistry {
  readonly #runtimes = new Map<string, CodingRuntime>();
  register(runtime: CodingRuntime): void {
    if (this.#runtimes.has(runtime.id))
      throw new Error(`Runtime already registered: ${runtime.id}`);
    this.#runtimes.set(runtime.id, runtime);
  }
  get(id: string): CodingRuntime {
    const runtime = this.#runtimes.get(id);
    if (!runtime) throw new Error(`Unknown runtime: ${id}`);
    return runtime;
  }
  list(): CodingRuntime[] {
    return [...this.#runtimes.values()];
  }
}
