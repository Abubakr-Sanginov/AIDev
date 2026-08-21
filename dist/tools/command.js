import { spawn } from 'node:child_process';
import { z } from 'zod';
import { safePath } from './path.js';
const input = z
    .object({
    command: z.string().min(1).max(2000),
    cwd: z.string().default('.'),
    timeoutMs: z.number().int().min(100).max(300_000).default(120_000),
})
    .strict();
const blocked = [
    /\brm\s+-rf\b/i,
    /\bdel\s+\/s\b/i,
    /\bformat\b/i,
    /\bshutdown\b/i,
    /\bmkfs\b/i,
    /\b(?:sudo|su)\b/i,
    /(?:^|\s)\.\.([/\\]|$)/,
];
const risky = [
    /\b(?:npm|pnpm|yarn)\s+(?:install|add|remove)\b/i,
    /\bgit\s+(?:reset|clean|push|commit|checkout)\b/i,
    /\b(?:rm|rmdir|del)\b/i,
];
export const runCommandTool = {
    definition: {
        name: 'run_command',
        description: 'Run a validated command inside the project with timeout and bounded output.',
        inputSchema: {
            properties: {
                command: { type: 'string' },
                cwd: { type: 'string' },
                timeoutMs: { type: 'number' },
            },
            required: ['command'],
        },
    },
    schema: input,
    async execute({ command, cwd, timeoutMs }, context) {
        if (blocked.some((pattern) => pattern.test(command)))
            throw new Error('Command is blocked by the safety policy.');
        if (risky.some((pattern) => pattern.test(command)) && !(await context.approve(command)))
            throw new Error('Command was not approved.');
        const workingDirectory = safePath(context.root, cwd);
        return new Promise((resolve, reject) => {
            const child = spawn(command, {
                cwd: workingDirectory,
                shell: true,
                windowsHide: true,
                env: { ...process.env, CI: '1', NO_COLOR: process.env.NO_COLOR ?? '1' },
            });
            const chunks = [];
            let size = 0;
            const append = (chunk) => {
                if (size < 100_000) {
                    chunks.push(chunk.subarray(0, 100_000 - size));
                    size += chunk.length;
                }
            };
            child.stdout.on('data', append);
            child.stderr.on('data', append);
            const timer = setTimeout(() => {
                child.kill();
                reject(new Error(`Command timed out after ${timeoutMs}ms.`));
            }, timeoutMs);
            child.on('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });
            child.on('close', (code) => {
                clearTimeout(timer);
                const output = Buffer.concat(chunks).toString('utf8');
                if (code !== 0)
                    reject(new Error(`Command exited with code ${code}.\n${output}`));
                else
                    resolve(output || `Command completed with code ${code}.`);
            });
        });
    },
};
