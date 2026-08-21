import { SharedLoopAgent } from './agents/agent.js';
import { prompts } from './agents/prompts.js';
import { allTools } from './tools/index.js';
import { ProjectMemory } from './memory.js';
export class Orchestrator {
    #memory;
    #provider;
    #ui;
    #context;
    #maxFixAttempts;
    #activity = [];
    constructor(options) {
        this.#memory = new ProjectMemory(options.root);
        this.#provider = options.provider;
        this.#ui = options.ui;
        this.#context = { root: options.root, approve: options.approve };
        this.#maxFixAttempts = options.maxFixAttempts ?? 2;
    }
    async run(goal) {
        const state = await this.#memory.initialize(goal);
        state.goal = goal;
        state.status = 'RUNNING';
        state.tasks = [
            this.#task('manager', 'Manager', 'Create an implementation plan.'),
            this.#task('architect', 'Architect', 'Design and document the architecture.'),
            this.#task('coder', 'Coder', 'Implement the approved plan.'),
            this.#task('tester', 'Tester', 'Verify typecheck, lint, tests, and build.'),
            this.#task('fixer', 'Fixer', 'Fix verification or review failures.'),
            this.#task('reviewer', 'Reviewer', 'Review quality, security, and requirements.'),
        ];
        await this.#persist(state);
        const manager = await this.#runRole('Manager', state, `Plan this task and define acceptance criteria:\n${goal}`);
        const architect = await this.#runRole('Architect', state, `Design the solution for this goal and write .ai-team/architecture.md:\n${goal}`, manager);
        await this.#runRole('Coder', state, `Implement the goal using the manager plan and architecture. Complete actual file and command work.`, `${manager}\n\n${architect}`);
        let report = await this.#runRole('Tester', state, 'Run all applicable verification. Do not modify source. Give exact failures and a verdict.');
        for (let attempt = 0; !this.#passed(report) && attempt < this.#maxFixAttempts; attempt++) {
            state.verificationAttempts++;
            await this.#memory.appendErrors(report);
            const fix = await this.#runRole('Fixer', state, 'Fix every root cause in the tester report.', report);
            report = await this.#runRole('Tester', state, 'Re-run all applicable verification after fixes and give a verdict.', fix);
        }
        if (!this.#passed(report))
            return this.#fail(state, 'Verification did not pass within the retry limit.');
        const review = await this.#runRole('Reviewer', state, `Review the completed project against this goal:\n${goal}`, report);
        if (!this.#passed(review)) {
            const fix = await this.#runRole('Fixer', state, 'Fix the actionable reviewer findings.', review);
            report = await this.#runRole('Tester', state, 'Verify the reviewer fixes and give a verdict.', fix);
            if (!this.#passed(report))
                return this.#fail(state, 'Review fixes failed verification.');
        }
        state.status = 'DONE';
        state.currentTask = 'All agents completed successfully.';
        await this.#persist(state);
        return state;
    }
    async #runRole(role, state, task, handoff = '') {
        const item = state.tasks.find((candidate) => candidate.role === role);
        if (!item)
            throw new Error(`Task for ${role} was not initialized.`);
        item.status = 'RUNNING';
        state.currentTask = `${role}: ${item.description}`;
        this.#activity.push(`${role} started.`);
        await this.#persist(state);
        try {
            const agent = new SharedLoopAgent({
                role,
                systemPrompt: prompts[role],
                provider: this.#provider,
                tools: allTools,
            });
            const context = `${await this.#memory.contextFor(role, state)}\n\nHandoff:\n${handoff || 'None'}`;
            const result = await agent.run(task, this.#context, context);
            item.status = 'DONE';
            item.result = result.output;
            this.#activity.push(`${role} completed in ${result.iterations} iteration(s).`);
            await this.#memory.recordAgent(role, result.output);
            await this.#persist(state);
            return result.output;
        }
        catch (error) {
            item.status = 'FAILED';
            item.result = error instanceof Error ? error.message : String(error);
            this.#activity.push(`${role} failed: ${item.result}`);
            await this.#persist(state);
            throw error;
        }
    }
    #passed(output) {
        return /VERDICT:\s*PASS\b/i.test(output);
    }
    #task(id, role, description) {
        return { id, role, description, status: 'WAITING' };
    }
    async #persist(state) {
        await this.#memory.saveState(state);
        await this.#memory.savePlan(state.tasks);
        this.#ui.render(state, this.#activity);
    }
    async #fail(state, reason) {
        state.status = 'FAILED';
        state.currentTask = reason;
        this.#activity.push(reason);
        await this.#persist(state);
        return state;
    }
}
