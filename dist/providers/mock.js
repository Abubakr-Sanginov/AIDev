export class MockProvider {
    #steps;
    #index = 0;
    constructor(steps) {
        this.#steps = steps;
    }
    async generate(messages, tools) {
        const step = this.#steps[this.#index++];
        if (!step)
            return { content: 'Mock sequence complete.', toolCalls: [] };
        return typeof step === 'function' ? step(messages, tools) : step;
    }
    get calls() {
        return this.#index;
    }
}
