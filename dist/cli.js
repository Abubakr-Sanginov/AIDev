#!/usr/bin/env node
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import { createDefaultRegistry } from './runtimes/default-registry.js';
import { RuntimeOrchestrator, workflowProgress, } from './runtimes/runtime-orchestrator.js';
import { StateStore } from './state-store.js';
import { roles } from './roles.js';
import { createApprover } from './approval.js';
import { validateProjectRoot } from './project-context.js';
import { formatDuration, panel, renderBanner, renderDashboard, resolveTheme, statusBadge, THEME_NAMES, } from './ui/ascii.js';
import { loadConfig, resetConfig, setConfigValue } from './config.js';
import { appendRunRecord, listRunRecords } from './history.js';
import { runDoctor } from './doctor.js';
import { writeReport } from './report.js';
const VERSION = '0.2.0';
const program = new Command();
program
    .name('ai-dev-team')
    .description('Orchestrate user-installed AI coding agents.')
    .version(VERSION);
program
    .option('-C, --directory <path>', 'project directory', process.cwd())
    .option('--runtime <id>', 'coding runtime: claude, opencode, codex, or mock')
    .option('--model <id>', 'model ID reported by the selected runtime; omit for Auto')
    .option('--approval <mode>', 'ask, always, or never', 'ask')
    .option('--agent-attempts <count>', 'attempts per agent/runtime stage', '3')
    .option('--retry-backoff-ms <ms>', 'initial exponential retry backoff', '1000')
    .option('--fix-attempts <count>', 'maximum tester-fixer-retest cycles', '2')
    .option('--theme <name>', `color theme: ${THEME_NAMES.join(', ')}`)
    .option('--verbose', 'show low-level runtime activity')
    .option('--runtime-terminal', 'show controlled real-runtime output in terminal windows')
    .option('--no-runtime-terminal', 'run real-runtime processes headlessly');
function options() {
    const value = program.opts();
    if (!['ask', 'always', 'never'].includes(value.approval))
        throw new Error('--approval must be ask, always, or never.');
    if (value.theme !== undefined)
        resolveTheme(value.theme);
    const maxAgentAttempts = Number.parseInt(value.agentAttempts, 10);
    const retryBackoffMs = Number.parseInt(value.retryBackoffMs, 10);
    const maxFixAttempts = Number.parseInt(value.fixAttempts, 10);
    if (maxAgentAttempts < 1 || retryBackoffMs < 0 || maxFixAttempts < 0)
        throw new Error('Retry counts must be non-negative; --agent-attempts must be at least 1.');
    return {
        root: path.resolve(value.directory),
        ...(value.runtime === undefined ? {} : { runtimeId: value.runtime }),
        ...(value.model === undefined ? {} : { model: value.model }),
        approval: value.approval,
        runtimeTerminal: value.runtimeTerminal,
        maxAgentAttempts,
        retryBackoffMs,
        maxFixAttempts,
        verbose: value.verbose ?? false,
        ...(value.theme === undefined ? {} : { theme: value.theme }),
    };
}
let sessionTheme;
function currentTheme() {
    return sessionTheme ?? resolveTheme(program.opts().theme);
}
async function prompt(question) {
    if (!process.stdin.isTTY)
        throw new Error('Interactive input is unavailable.');
    const reader = createInterface({ input: process.stdin, output: process.stdout });
    try {
        return (await reader.question(question)).trim();
    }
    finally {
        reader.close();
    }
}
async function choose(label, choices) {
    process.stdout.write(`${label}\n${choices.map((choice, index) => `  ${index + 1}) ${choice.name}`).join('\n')}\n`);
    const answer = await prompt('Select a number: ');
    const index = Number.parseInt(answer, 10) - 1;
    const choice = choices[index];
    if (!choice)
        throw new Error('Invalid selection.');
    return choice.id;
}
async function resolveGoal(value) {
    return value?.trim() || prompt('What should the AI development team build? ');
}
async function resolveRuntimeId(value) {
    if (value)
        return value;
    if (!process.stdin.isTTY)
        throw new Error('Choose a runtime with --runtime claude, opencode, or codex.');
    return choose('Choose a provider:', [
        { id: 'claude', name: 'Claude Code' },
        { id: 'opencode', name: 'OpenCode' },
        { id: 'codex', name: 'Codex' },
    ]);
}
async function resolveModel(runtime, root, requested) {
    const discovery = await runtime.discoverModels(root);
    if (requested) {
        if (!discovery.models.includes(requested))
            throw new Error(`Model '${requested}' was not reported as available by ${runtime.name}.`);
        return requested;
    }
    if (discovery.message)
        process.stdout.write(`${discovery.message}\n`);
    if (!process.stdin.isTTY)
        return undefined;
    const selected = await choose('Choose a model:', [
        { id: 'auto', name: 'Auto (provider chooses and may switch models)' },
        ...discovery.models.map((model) => ({ id: model, name: model })),
    ]);
    return selected === 'auto' ? undefined : selected;
}
let rendered = false;
let bannerShown = false;
const LOW_VALUE_ACTIVITY = /(?:event:\s*)?(?:step_start|step_finish|tool_use)\b/i;
export function renderRuntimeState(state, root, verbose = false) {
    const latest = new Map(state.events.map((event) => [event.roleId, event.status]));
    const progress = workflowProgress(state);
    const width = 20;
    const filled = progress.total === 0 ? 0 : Math.round((progress.completed / progress.total) * width);
    const event = [...state.events]
        .reverse()
        .find((candidate) => verbose || !LOW_VALUE_ACTIVITY.test(candidate.message));
    const attempt = event?.attempt ? `${event.attempt}/${event.maxAttempts ?? event.attempt}` : '-';
    const retry = [...state.events].reverse().find((candidate) => candidate.status === 'RETRYING');
    const lines = [
        `AI DEV TEAM  ${state.status}`,
        `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}] ${progress.completed}/${progress.total}`,
        `Path: ${root}`,
        `Phase: ${state.currentRoleId ?? (state.status === 'RUNNING' ? 'waiting' : 'complete')}  Attempt: ${attempt}`,
        ...roles.map((role) => `${role.name.padEnd(19)} ${latest.get(role.id) ?? 'WAITING'}`),
        `Latest: ${event ? `${event.roleId}: ${(event.message.split('\n')[0] ?? '').slice(0, 180)}` : 'Waiting'}`,
        `Retry: ${retry ? (retry.message.split('\n')[0] ?? '').slice(0, 180) : 'none'}`,
    ];
    if (state.status !== 'RUNNING') {
        const failures = state.events.filter((candidate) => candidate.status === 'FAILED');
        lines.push(`Summary: ${state.status === 'DONE' ? 'Implementation, verification, and review completed.' : `${failures.length} terminal failure(s); inspect .ai-dev-team logs and retry after addressing the latest diagnostic.`}`);
    }
    return lines.join('\n') + '\n';
}
function render(state) {
    const config = options();
    const theme = currentTheme();
    if (process.stdout.isTTY && rendered)
        process.stdout.write('\x1B[H\x1B[2J');
    const showBanner = Boolean(process.stdout.isTTY) || !bannerShown;
    rendered = true;
    bannerShown = true;
    process.stdout.write(`${showBanner ? renderBanner(theme, VERSION) : ''}${renderDashboard(state, config.root, theme, { verbose: config.verbose })}\n`);
}
async function ensureRuntime(runtimeId, approval) {
    const runtime = createDefaultRegistry().get(runtimeId);
    let detection = await runtime.detect();
    if (!detection.installed) {
        const instructions = runtime.getInstallInstructions();
        process.stdout.write(`${runtime.name} is not installed.\nOfficial method: ${instructions.command}\n${instructions.officialUrl}\n`);
        if (!(await createApprover(approval)(instructions.command)))
            throw new Error('Runtime installation cancelled.');
        const installed = await runtime.install();
        if (!installed.success)
            throw new Error(installed.message);
        detection = await runtime.detect();
    }
    if (!detection.ready) {
        throw new Error(detection.message ||
            `${runtime.name} is installed but not ready. Authenticate it in its own CLI and retry.`);
    }
    return runtime;
}
async function recordHistory(root, goal, state, model) {
    try {
        const finishedAt = new Date().toISOString();
        const startedMs = state.startedAt ? Date.parse(state.startedAt) : Number.NaN;
        const record = {
            goal,
            runtimeId: state.runtimeId,
            status: state.status,
            attempts: state.attempts,
            finishedAt,
            ...(model === undefined ? {} : { model }),
            ...(state.startedAt === undefined ? {} : { startedAt: state.startedAt }),
            ...(Number.isNaN(startedMs) ? {} : { durationMs: Date.now() - startedMs }),
        };
        await appendRunRecord(root, record);
    }
    catch (error) {
        process.stderr.write(`[ WARNING ] Could not record run history: ${error instanceof Error ? error.message : String(error)}\n`);
    }
}
async function run(goal) {
    const config = options();
    const saved = await loadConfig(config.root).catch(() => ({}));
    sessionTheme = resolveTheme(config.theme ?? saved.theme);
    const approval = program.getOptionValueSource('approval') === 'cli'
        ? config.approval
        : (saved.approval ?? config.approval);
    await validateProjectRoot(config.root);
    const runtimeId = await resolveRuntimeId(config.runtimeId ?? saved.runtime);
    const runtime = await ensureRuntime(runtimeId, approval);
    const model = await resolveModel(runtime, config.root, config.model ?? saved.model);
    const task = await resolveGoal(goal);
    if (!task)
        throw new Error('Task cannot be empty.');
    process.stdout.write(renderBanner(sessionTheme, VERSION));
    bannerShown = true;
    const store = new StateStore(config.root);
    const orchestrator = new RuntimeOrchestrator({
        root: config.root,
        runtime,
        ...(model === undefined ? {} : { model }),
        visibleRuntime: config.runtimeTerminal && runtime.id !== 'mock',
        maxAgentAttempts: config.maxAgentAttempts,
        retryBackoffMs: config.retryBackoffMs,
        maxFixAttempts: config.maxFixAttempts,
        onState: async (state) => {
            await store.save(state);
            render(state);
        },
        onStateError: (error) => {
            process.stderr.write(`[ WARNING ] State persistence failed: ${error instanceof Error ? error.message : String(error)}\n`);
        },
    });
    const state = await orchestrator.run(task);
    await recordHistory(config.root, task, state, model);
    process.exitCode = state.status === 'DONE' ? 0 : 1;
}
program
    .argument('[task...]', 'development task')
    .action(async (task) => run(task.join(' ')));
program
    .command('init')
    .description('Initialize project state.')
    .action(async () => {
    const root = await validateProjectRoot(options().root);
    await new StateStore(root).initialize();
    process.stdout.write('[ DONE ] Initialized .ai-dev-team.\n');
});
program
    .command('run [task...]')
    .description('Run a workflow.')
    .action(async (task) => run(task.join(' ')));
program
    .command('resume')
    .description('Restart the persisted goal.')
    .action(async () => {
    const state = await new StateStore(options().root).load();
    if (!state)
        throw new Error('No saved workflow.');
    await run(state.goal);
});
program
    .command('status')
    .description('Show persisted status.')
    .action(async () => {
    const state = await new StateStore(options().root).load();
    if (!state)
        throw new Error('No saved workflow.');
    render(state);
});
program
    .command('agents')
    .description('List roles.')
    .action(() => {
    process.stdout.write(panel('Agents', roles.map((role) => ` ▸ ${role.name.padEnd(19)} ${role.description}`), currentTheme()) + '\n');
});
program
    .command('runtimes')
    .description('Detect coding runtimes.')
    .action(async () => {
    process.stdout.write('RUNTIME STATUS\n--------------\n');
    for (const runtime of createDefaultRegistry().list()) {
        const result = await runtime.detect();
        process.stdout.write(`${runtime.name.padEnd(16)} ${result.ready ? 'READY' : result.installed ? 'NOT READY' : 'NOT INSTALLED'}${result.version ? `  ${result.version}` : ''}\n`);
    }
});
program
    .command('doctor')
    .description('Diagnose Node.js, project directory, config, and coding runtimes.')
    .action(async () => {
    const config = options();
    const theme = currentTheme();
    process.stdout.write(renderBanner(theme, VERSION));
    const checks = await runDoctor(config.root);
    for (const check of checks) {
        const badge = check.ok ? theme.success('[ OK ]') : theme.failure('[FAIL]');
        process.stdout.write(`${badge} ${check.name} — ${check.detail}\n`);
    }
    const failures = checks.filter((check) => !check.ok);
    process.stdout.write(failures.length === 0
        ? theme.success('\nAll checks passed.\n')
        : theme.failure(`\n${failures.length} check(s) need attention.\n`));
    if (failures.length > 0)
        process.exitCode = 1;
});
program
    .command('history')
    .description('Show recent runs recorded for this project.')
    .action(async () => {
    const config = options();
    const theme = currentTheme();
    const records = await listRunRecords(config.root);
    if (records.length === 0) {
        process.stdout.write('No runs recorded yet.\n');
        return;
    }
    const lines = records.map((record) => {
        const when = record.finishedAt.slice(0, 19).replace('T', ' ');
        const duration = record.durationMs === undefined ? '-' : formatDuration(record.durationMs);
        const goal = record.goal.length > 48 ? `${record.goal.slice(0, 47)}…` : record.goal;
        return `${statusBadge(record.status, theme)} ${when}  ${duration.padEnd(8)} ${record.runtimeId.padEnd(10)} ${goal}`;
    });
    process.stdout.write(panel('Run history', lines, theme) + '\n');
});
program
    .command('report')
    .description('Export a Markdown report of the latest persisted run.')
    .action(async () => {
    const config = options();
    const state = await new StateStore(config.root).load();
    if (!state)
        throw new Error('No saved workflow.');
    const file = await writeReport(config.root, state);
    process.stdout.write(`[ DONE ] Report written to ${file}\n`);
});
program
    .command('config [args...]')
    .description('Show or set persistent defaults: runtime, model, approval, theme.')
    .action(async (args) => {
    const root = options().root;
    const [first] = args;
    if (first === 'reset') {
        await resetConfig(root);
        process.stdout.write('[ DONE ] Config reset.\n');
        return;
    }
    const key = first === 'set' ? args[1] : first;
    const value = first === 'set' ? args[2] : args[1];
    if (key === undefined) {
        const entries = Object.entries(await loadConfig(root));
        if (entries.length === 0) {
            process.stdout.write('No defaults configured. Example: ai-dev-team config set runtime claude\n');
            return;
        }
        for (const [name, entry] of entries)
            process.stdout.write(`${name} = ${entry}\n`);
        return;
    }
    if (value === undefined)
        throw new Error('Usage: ai-dev-team config set <key> <value> | ai-dev-team config reset');
    await setConfigValue(root, key, value);
    process.stdout.write(`[ DONE ] ${key} = ${value}\n`);
});
program
    .command('clean')
    .description('Delete the persisted .ai-dev-team state directory.')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(async (commandOptions) => {
    const config = options();
    const directory = new StateStore(config.root).directory;
    if (!commandOptions.yes) {
        if (!process.stdin.isTTY)
            throw new Error('Re-run with --yes to clean without a terminal.');
        const answer = await prompt(`Delete ${directory}? [y/N] `);
        if (!['y', 'yes'].includes(answer.toLowerCase())) {
            process.stdout.write('Aborted.\n');
            return;
        }
    }
    await rm(directory, { recursive: true, force: true });
    process.stdout.write('[ DONE ] Removed .ai-dev-team state.\n');
});
program
    .command('launch')
    .description('Open the selected real runtime in a new visible terminal.')
    .action(async () => {
    const config = options();
    const runtime = await ensureRuntime(await resolveRuntimeId(config.runtimeId), config.approval);
    const session = await runtime.launch({
        workingDirectory: config.root,
        roleId: 'interactive',
        visible: true,
    });
    process.stdout.write(`[ DONE ] Opened ${runtime.name} session ${session.id}.\n`);
});
program
    .command('stop')
    .description('Mark the persisted workflow stopped.')
    .action(async () => {
    const store = new StateStore(options().root);
    const state = await store.load();
    if (!state)
        throw new Error('No saved workflow.');
    state.status = 'FAILED';
    state.events.push({ roleId: 'manager', status: 'FAILED', message: 'Stopped by user.' });
    await store.save(state);
    process.stdout.write('[ DONE ] Workflow marked stopped.\n');
});
program
    .command('logs')
    .description('Show persisted activity.')
    .action(async () => {
    const state = await new StateStore(options().root).load();
    if (!state)
        throw new Error('No saved workflow.');
    for (const event of state.events)
        process.stdout.write(`${event.roleId} [ ${event.status} ] ${event.message}\n`);
});
program.parseAsync().catch((error) => {
    process.stderr.write(`[ FAILED ] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
