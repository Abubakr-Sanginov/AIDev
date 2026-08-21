import { randomUUID } from 'node:crypto';
export class MockRuntime {
    id = 'mock';
    name = 'Mock Runtime';
    #responses;
    sessions = new Map();
    constructor(responses = []) {
        this.#responses = responses;
    }
    async detect() {
        return { installed: true, ready: true, authenticated: 'yes', version: '1.0.0' };
    }
    getInstallInstructions() {
        return { command: '', description: 'Built in for tests.', officialUrl: '' };
    }
    async install() {
        return { success: true, message: 'Mock runtime is built in.' };
    }
    async authenticate() {
        return { success: true, message: 'Mock runtime is ready.' };
    }
    async discoverModels() {
        return { models: [] };
    }
    async launch(options) {
        const session = {
            id: randomUUID(),
            runtimeId: this.id,
            roleId: options.roleId,
            workingDirectory: options.workingDirectory,
            status: 'running',
            createdAt: new Date().toISOString(),
        };
        this.sessions.set(session.id, session);
        return session;
    }
    async execute(session, _request) {
        const response = this.#responses.shift() ?? { behavior: 'success', output: 'VERDICT: PASS' };
        if (response.behavior === 'timeout')
            throw new Error('Mock runtime timed out.');
        if (response.behavior === 'crash') {
            session.status = 'failed';
            throw new Error('Mock runtime crashed.');
        }
        session.status = response.behavior === 'success' ? 'completed' : 'failed';
        return {
            success: response.behavior === 'success',
            output: response.output ?? '',
            sessionId: session.id,
            exitCode: response.behavior === 'success' ? 0 : 1,
        };
    }
    async pause(session) {
        session.status = 'paused';
    }
    async resume(session) {
        session.status = 'running';
    }
    async stop(session) {
        session.status = 'stopped';
    }
    async getStatus(session) {
        return session.status;
    }
}
