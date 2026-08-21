import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildLogFollowerOptions } from '../../terminal/log-follower.js';
import { runProcess } from '../process.js';
export function buildCodexExecArgs(request) {
    const modelArgs = request.model ? ['--model', request.model] : [];
    if (request.resumeSessionId)
        return [
            'exec',
            'resume',
            '--json',
            '--color',
            'never',
            ...modelArgs,
            request.resumeSessionId,
            request.prompt,
        ];
    return [
        'exec',
        '--json',
        '--color',
        'never',
        '--sandbox',
        request.toolPolicy === 'read-only' ? 'read-only' : 'workspace-write',
        ...modelArgs,
        request.prompt,
    ];
}
export function parseCodexJsonEvents(stdout) {
    let sessionId;
    const text = [];
    for (const line of stdout.split(/\r?\n/u)) {
        if (!line.trim())
            continue;
        const event = JSON.parse(line);
        if (typeof event.thread_id === 'string')
            sessionId = event.thread_id;
        if (event.item?.type === 'agent_message' && typeof event.item.text === 'string')
            text.push(event.item.text);
        else if (typeof event.message === 'string')
            text.push(event.message);
    }
    if (text.length === 0)
        throw new Error('Codex JSON event stream contained no textual result.');
    return { output: text.join('\n'), ...(sessionId === undefined ? {} : { sessionId }) };
}
export class CodexRuntime {
    id = 'codex';
    name = 'Codex CLI';
    #terminal;
    #run;
    #sessionIds = new Map();
    constructor(terminal, processRunner = runProcess) {
        this.#terminal = terminal;
        this.#run = processRunner;
    }
    async detect() {
        try {
            const versionResult = await this.#run('codex', ['--version'], process.cwd(), 10_000);
            if (versionResult.code !== 0) {
                return {
                    installed: true,
                    ready: false,
                    authenticated: 'unknown',
                    message: (versionResult.stderr || versionResult.stdout).trim(),
                };
            }
            const authResult = await this.#run('codex', ['login', 'status'], process.cwd(), 10_000);
            return {
                installed: true,
                ready: authResult.code === 0,
                authenticated: authResult.code === 0 ? 'yes' : 'no',
                version: (versionResult.stdout || versionResult.stderr).trim(),
                ...(authResult.code === 0
                    ? {}
                    : {
                        message: (authResult.stderr || authResult.stdout).trim() || 'Codex is not authenticated.',
                    }),
            };
        }
        catch {
            return {
                installed: false,
                ready: false,
                authenticated: 'unknown',
                message: 'Codex command was not found.',
            };
        }
    }
    getInstallInstructions() {
        return {
            command: 'npm install -g @openai/codex',
            description: 'Official npm installation for Codex CLI.',
            officialUrl: 'https://developers.openai.com/codex/cli/',
        };
    }
    async install() {
        const result = await this.#run('npm', ['install', '-g', '@openai/codex'], process.cwd(), 300_000);
        return { success: result.code === 0, message: (result.stdout || result.stderr).trim() };
    }
    async authenticate(workingDirectory) {
        await this.#terminal.open({
            cwd: workingDirectory,
            command: 'codex',
            args: ['login'],
            title: 'Codex Login',
        });
        return { success: true, message: 'Codex login opened in a visible terminal.' };
    }
    async discoverModels() {
        return {
            models: [],
            message: 'Codex CLI does not expose a safe account-filtered model list; Auto uses the signed-in account default.',
        };
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
        if (options.visible) {
            const directory = path.join(options.workingDirectory, '.ai-dev-team', 'logs');
            await mkdir(directory, { recursive: true });
            session.outputFile = path.join(directory, `${session.id}-${options.roleId}.log`);
            await writeFile(session.outputFile, `[ ACTIVE ] Codex ${options.roleId} controlled process output\n`, 'utf8');
            try {
                const terminalProcess = await this.#terminal.open(buildLogFollowerOptions(options.workingDirectory, session.outputFile, this.name, options.roleId));
                session.terminalOpened = true;
                if (terminalProcess.processId !== undefined)
                    session.processId = terminalProcess.processId;
            }
            catch (error) {
                session.terminalError = error instanceof Error ? error.message : String(error);
            }
        }
        return session;
    }
    async execute(session, request) {
        const resumeSessionId = request.resumeSessionId ?? this.#sessionIds.get(session.id);
        const effective = { ...request, ...(resumeSessionId ? { resumeSessionId } : {}) };
        const result = await this.#run('codex', buildCodexExecArgs(effective), session.workingDirectory, undefined, async (activity) => {
            if (activity.type === 'started') {
                await request.onActivity?.({
                    type: 'child-started',
                    message: `Codex child process started${activity.processId === undefined ? '' : ` (PID ${activity.processId})`}.`,
                    ...(activity.processId === undefined ? {} : { processId: activity.processId }),
                });
                return;
            }
            const text = activity.text ?? '';
            if (session.outputFile && text)
                await appendFile(session.outputFile, text, 'utf8');
            const line = text.split(/\r?\n/u).find((item) => item.trim());
            if (line)
                await request.onActivity?.({ type: 'output', message: line.trim().slice(0, 160) });
        });
        if (session.outputFile)
            await appendFile(session.outputFile, `\n[ ${result.code === 0 ? 'COMPLETED' : 'FAILED'} ] Controlled Codex process exited with code ${result.code}.\n`, 'utf8');
        if (result.code !== 0) {
            session.status = 'failed';
            return {
                success: false,
                output: (result.stderr || result.stdout).trim(),
                exitCode: result.code,
            };
        }
        try {
            const parsed = parseCodexJsonEvents(result.stdout);
            session.status = 'completed';
            if (parsed.sessionId)
                this.#sessionIds.set(session.id, parsed.sessionId);
            return { success: true, ...parsed, exitCode: result.code };
        }
        catch (error) {
            session.status = 'failed';
            return {
                success: false,
                output: error instanceof Error ? error.message : String(error),
                exitCode: result.code,
            };
        }
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
