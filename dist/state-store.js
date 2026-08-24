import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { durableWriteFile } from './durable-file.js';
import { roles } from './roles.js';
const GITIGNORE_ENTRIES = ['.ai-dev-team/', '.ai-team/'];
export class StateStore {
    directory;
    #writeOptions;
    #gitignoreChecked = false;
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
        await this.#ensureGitIgnored();
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
    /**
     * Keeps runtime state out of the target project's git status by appending the
     * state directories to its .gitignore. Runs once per store instance and only
     * for projects that already use Git. Best effort, never throws.
     */
    async #ensureGitIgnored() {
        if (this.#gitignoreChecked)
            return;
        this.#gitignoreChecked = true;
        const root = path.dirname(this.directory);
        try {
            await lstat(path.join(root, '.git')); // a plain file for worktrees and submodules
        }
        catch {
            return;
        }
        const file = path.join(root, '.gitignore');
        let content = '';
        try {
            content = await readFile(file, 'utf8');
        }
        catch {
            // No .gitignore yet; it is created below.
        }
        const present = new Set(content
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .filter((line) => line !== '' && !line.startsWith('#')));
        const missing = GITIGNORE_ENTRIES.filter((entry) => !present.has(entry) && !present.has(entry.slice(0, -1)));
        if (missing.length === 0)
            return;
        try {
            const separator = content === '' || content.endsWith('\n') ? '' : '\n';
            await writeFile(file, `${content}${separator}${missing.join('\n')}\n`, 'utf8');
        }
        catch {
            // A read-only project must not fail the run over a convenience entry.
        }
    }
}
function scheduledRoles(state) {
    const terminal = new Set(['DONE', 'FAILED', 'SKIPPED', 'CANCELLED']);
    return roles
        .map((role) => role.id)
        .filter((roleId) => state.events.some((event) => event.roleId === roleId && terminal.has(event.status)));
}
