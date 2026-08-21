import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { durableWriteFile } from './durable-file.js';
import { roles } from './roles.js';
export class StateStore {
    directory;
    #writeOptions;
    constructor(root, writeOptions = {}) {
        this.directory = path.join(root, '.ai-dev-team');
        this.#writeOptions = writeOptions;
    }
    async initialize() {
        await Promise.all([
            mkdir(path.join(this.directory, 'logs'), { recursive: true }),
            mkdir(path.join(this.directory, 'sessions'), { recursive: true }),
        ]);
        for (const file of ['architecture.md', 'decisions.md', 'errors.md']) {
            try {
                await readFile(path.join(this.directory, file), 'utf8');
            }
            catch {
                await writeFile(path.join(this.directory, file), `# ${file.slice(0, -3)}\n`, 'utf8');
            }
        }
    }
    async save(state) {
        await this.initialize();
        await this.#atomic('state.json', JSON.stringify(state, null, 2) + '\n');
        await this.#atomic('tasks.json', JSON.stringify(state.events, null, 2) + '\n');
        await this.#atomic('plan.json', JSON.stringify({
            goal: state.goal,
            roles: roles.map((role) => role.id),
            scheduledRoles: scheduledRoles(state),
        }, null, 2) + '\n');
        for (const session of state.sessions)
            await this.#atomic(path.join('sessions', `${session.id}.json`), JSON.stringify(session, null, 2) + '\n');
    }
    async load() {
        const stateFile = path.join(this.directory, 'state.json');
        for (let attempt = 0;; attempt++) {
            try {
                return JSON.parse(await readFile(stateFile, 'utf8'));
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
                if (attempt >= 4)
                    return undefined;
                await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
            }
        }
    }
    async #atomic(file, content) {
        await durableWriteFile(path.join(this.directory, file), content, this.#writeOptions);
    }
}
function scheduledRoles(state) {
    const terminal = new Set(['DONE', 'FAILED', 'SKIPPED', 'CANCELLED']);
    return roles
        .map((role) => role.id)
        .filter((roleId) => state.events.some((event) => event.roleId === roleId && terminal.has(event.status)));
}
