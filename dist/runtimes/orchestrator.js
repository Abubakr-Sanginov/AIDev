import { getRole } from '../roles.js';
export function workflowProgress(state) {
    return { completed: state.completedPhases ?? 0, total: state.totalPhases ?? 5 };
}
export class RuntimeOrchestrator {
    #root;
    #runtime;
    #maxFixAttempts;
    #visibleRuntime;
    #heartbeatMs;
    #model;
    #onState;
    constructor(options) {
        this.#root = options.root;
        this.#runtime = options.runtime;
        this.#maxFixAttempts = options.maxFixAttempts ?? 2;
        this.#visibleRuntime = options.visibleRuntime ?? options.runtime.id !== 'mock';
        this.#heartbeatMs = options.heartbeatMs ?? 2_000;
        if (options.model !== undefined)
            this.#model = options.model;
        this.#onState = options.onState ?? (() => undefined);
    }
    async run(goal) {
        const now = new Date().toISOString();
        const state = {
            goal,
            runtimeId: this.#runtime.id,
            status: 'RUNNING',
            attempts: 0,
            sessions: [],
            events: [],
            startedAt: now,
            updatedAt: now,
            completedPhases: 0,
            totalPhases: 5,
        };
        const manager = await this.#execute('manager', `User goal:\n${goal}`, state);
        const architect = await this.#execute('architect', this.#handoff(goal, manager), state);
        await this.#execute('coder', this.#handoff(goal, manager, architect), state);
        let test = await this.#execute('tester', this.#handoff(goal, manager, architect), state);
        while (!this.#passed(test) && state.attempts < this.#maxFixAttempts) {
            state.attempts++;
            const fix = await this.#execute('fixer', this.#handoff(goal, test), state);
            test = await this.#execute('tester', this.#handoff(goal, fix), state);
        }
        if (!this.#passed(test)) {
            state.status = 'FAILED';
            await this.#onState(state);
            return state;
        }
        const review = await this.#execute('reviewer', this.#handoff(goal, test), state);
        state.status = this.#passed(review) ? 'DONE' : 'FAILED';
        await this.#onState(state);
        return state;
    }
    async #execute(roleId, context, state) {
        const role = getRole(roleId);
        const session = await this.#runtime.launch({
            workingDirectory: this.#root,
            roleId,
            visible: this.#visibleRuntime,
        });
        state.sessions.push(session);
        state.currentRoleId = roleId;
        this.#event(state, roleId, 'RUNNING', `${role.name} started.`);
        if (session.terminalOpened)
            this.#event(state, roleId, 'ACTIVE', `Runtime terminal opened for ${role.name}.`);
        if (session.terminalError)
            this.#event(state, roleId, 'ACTIVE', `Warning: runtime terminal could not be opened: ${session.terminalError}`);
        await this.#onState(state);
        const heartbeat = setInterval(() => {
            state.updatedAt = new Date().toISOString();
            void this.#onState(state);
        }, this.#heartbeatMs);
        try {
            const result = await this.#runtime.execute(session, {
                prompt: `${role.systemPrompt}\n\n${context}`,
                ...(this.#model === undefined ? {} : { model: this.#model }),
                onActivity: async (activity) => {
                    this.#event(state, roleId, 'ACTIVE', activity.message);
                    await this.#onState(state);
                },
            });
            clearInterval(heartbeat);
            this.#event(state, roleId, result.success ? 'DONE' : 'FAILED', result.output);
            const scheduled = new Set(['manager', 'architect', 'coder', 'tester', 'reviewer']);
            state.completedPhases = new Set(state.events
                .filter((event) => event.status === 'DONE' && scheduled.has(event.roleId))
                .map((event) => event.roleId)).size;
            await this.#onState(state);
            return result;
        }
        catch (error) {
            clearInterval(heartbeat);
            this.#event(state, roleId, 'FAILED', error instanceof Error ? error.message : String(error));
            state.status = 'FAILED';
            await this.#onState(state);
            throw error;
        }
    }
    #event(state, roleId, status, message) {
        const timestamp = new Date().toISOString();
        state.updatedAt = timestamp;
        state.events.push({ roleId, status, message, timestamp });
    }
    #handoff(goal, ...results) {
        return `User goal:\n${goal}\n\nPrevious role results:\n${results.map((result) => result.output).join('\n\n')}`;
    }
    #passed(result) {
        return result.success && /VERDICT:\s*PASS\b/i.test(result.output);
    }
}
