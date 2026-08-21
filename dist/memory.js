import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { durableWriteFile } from './durable-file.js';
const memoryFiles = ['architecture.md', 'decisions.md', 'errors.md'];
const agentRoles = ['Manager', 'Architect', 'Coder', 'Tester', 'Fixer', 'Reviewer'];
export class ProjectMemory {
    directory;
    constructor(root) {
        this.directory = path.join(root, '.ai-team');
    }
    async initialize(goal = '') {
        await mkdir(path.join(this.directory, 'agents'), { recursive: true });
        for (const file of memoryFiles)
            await this.#writeIfMissing(file, `# ${file.replace('.md', '')}\n`);
        for (const role of agentRoles)
            await this.#writeIfMissing(path.join('agents', `${role.toLowerCase()}.md`), `# ${role}\n`);
        const existing = await this.loadState();
        if (existing)
            return existing;
        const state = {
            version: 1,
            goal,
            status: 'WAITING',
            currentTask: 'Not started',
            updatedAt: new Date().toISOString(),
            tasks: [],
            verificationAttempts: 0,
        };
        await this.saveState(state);
        await this.savePlan([]);
        return state;
    }
    async loadState() {
        try {
            return JSON.parse(await readFile(path.join(this.directory, 'state.json'), 'utf8'));
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return undefined;
            throw error;
        }
    }
    async saveState(state) {
        state.updatedAt = new Date().toISOString();
        await this.#atomicWrite('state.json', JSON.stringify(state, null, 2) + '\n');
    }
    async savePlan(tasks) {
        await this.#atomicWrite('plan.json', JSON.stringify({ tasks }, null, 2) + '\n');
    }
    async recordAgent(role, output) {
        await this.#atomicWrite(path.join('agents', `${role.toLowerCase()}.md`), `# ${role}\n\n${output}\n`);
    }
    async appendErrors(report) {
        const file = path.join(this.directory, 'errors.md');
        const current = await readFile(file, 'utf8');
        await writeFile(file, `${current}\n## ${new Date().toISOString()}\n\n${report}\n`, 'utf8');
    }
    async contextFor(role, state) {
        const parts = [`Goal: ${state.goal}`, `State: ${JSON.stringify(state.tasks)}`];
        if (role !== 'Manager' && role !== 'Architect') {
            try {
                parts.push(`Architecture:\n${await readFile(path.join(this.directory, 'architecture.md'), 'utf8')}`);
            }
            catch {
                /* Optional. */
            }
        }
        return parts.join('\n\n');
    }
    async #writeIfMissing(file, content) {
        try {
            await readFile(path.join(this.directory, file), 'utf8');
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
            await writeFile(path.join(this.directory, file), content, 'utf8');
        }
    }
    async #atomicWrite(file, content) {
        await durableWriteFile(path.join(this.directory, file), content);
    }
}
