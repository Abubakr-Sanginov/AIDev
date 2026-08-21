import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from '../process.js';
import { buildLogFollowerOptions } from '../../terminal/log-follower.js';
export class ClaudeCodeRuntime {
    id = 'claude';
    name = 'Claude Code';
    #terminal;
    #run;
    #sessions = new Map();
    constructor(terminal, processRunner = runProcess) {
        this.#terminal = terminal;
        this.#run = processRunner;
    }
    async detect() {
        try {
            const versionResult = await this.#run('claude', ['--version'], process.cwd(), 10_000);
            if (versionResult.code !== 0) {
                return {
                    installed: true,
                    ready: false,
                    authenticated: 'unknown',
                    message: (versionResult.stderr || versionResult.stdout).trim(),
                };
            }
            const authResult = await this.#run('claude', ['auth', 'status', '--json'], process.cwd(), 10_000);
            return {
                installed: true,
                ready: authResult.code === 0,
                authenticated: authResult.code === 0 ? 'yes' : 'no',
                version: versionResult.stdout.trim() || versionResult.stderr.trim(),
                ...(authResult.code === 0
                    ? {}
                    : {
                        message: (authResult.stderr || authResult.stdout).trim() ||
                            'Claude Code is not authenticated.',
                    }),
            };
        }
        catch {
            return {
                installed: false,
                ready: false,
                authenticated: 'unknown',
                message: 'Claude Code command was not found.',
            };
        }
    }
    getInstallInstructions() {
        return {
            command: 'npm install -g @anthropic-ai/claude-code',
            description: 'Official npm installation for Claude Code.',
            officialUrl: 'https://docs.anthropic.com/en/docs/claude-code/getting-started',
        };
    }
    async install() {
        const result = await this.#run('npm', ['install', '-g', '@anthropic-ai/claude-code'], process.cwd(), 300_000);
        return { success: result.code === 0, message: result.stdout || result.stderr };
    }
    async authenticate(workingDirectory) {
        await this.#terminal.open({
            cwd: workingDirectory,
            command: 'claude',
            args: [],
            title: 'Claude Code Authentication',
        });
        return {
            success: true,
            message: 'Claude Code opened. Complete authentication in its terminal.',
        };
    }
    async discoverModels() {
        return {
            models: [],
            message: 'Claude Code does not expose a safe account-filtered model list; Auto uses the account default and provider fallback.',
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
            await writeFile(session.outputFile, `[ ACTIVE ] Claude Code ${options.roleId} controlled process output\n`, 'utf8');
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
        this.#sessions.set(session.id, session);
        return session;
    }
    async execute(session, request) {
        session.status = 'running';
        const args = ['-p', request.prompt, '--output-format', 'json'];
        if (request.model)
            args.push('--model', request.model);
        if (request.resumeSessionId)
            args.push('--resume', request.resumeSessionId);
        if (request.toolPolicy === 'read-only')
            args.push('--disallowedTools', 'Bash, Edit, Write, MultiEdit, NotebookEdit');
        const result = await this.#run('claude', args, session.workingDirectory, undefined, async (activity) => {
            if (activity.type === 'started') {
                await request.onActivity?.({
                    type: 'child-started',
                    message: `Claude Code child process started${activity.processId === undefined ? '' : ` (PID ${activity.processId})`}.`,
                    ...(activity.processId === undefined ? {} : { processId: activity.processId }),
                });
                return;
            }
            const text = activity.text ?? '';
            if (session.outputFile && text)
                await appendFile(session.outputFile, text, 'utf8');
            const line = text.split(/\r?\n/u).find((item) => item.trim());
            if (line)
                await request.onActivity?.({
                    type: 'output',
                    message: line.trim().slice(0, 160),
                });
        });
        if (session.outputFile)
            await appendFile(session.outputFile, `\n[ ${result.code === 0 ? 'COMPLETED' : 'FAILED'} ] Controlled Claude Code process exited with code ${result.code}.\n`, 'utf8');
        session.status = result.code === 0 ? 'completed' : 'failed';
        let output = result.stdout || result.stderr;
        let runtimeSessionId;
        try {
            const parsed = JSON.parse(result.stdout);
            output = parsed.result ?? output;
            runtimeSessionId = parsed.session_id;
        }
        catch {
            /* Preserve raw official CLI output. */
        }
        return {
            success: result.code === 0,
            output,
            ...(runtimeSessionId ? { sessionId: runtimeSessionId } : {}),
            exitCode: result.code,
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
