export class RuntimeRegistry {
    #runtimes = new Map();
    register(runtime) {
        if (this.#runtimes.has(runtime.id))
            throw new Error(`Runtime already registered: ${runtime.id}`);
        this.#runtimes.set(runtime.id, runtime);
    }
    get(id) {
        const runtime = this.#runtimes.get(id);
        if (!runtime)
            throw new Error(`Unknown runtime: ${id}`);
        return runtime;
    }
    list() {
        return [...this.#runtimes.values()];
    }
}
