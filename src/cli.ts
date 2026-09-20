#!/usr/bin/env node
import path from 'node:path';
import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import { createDefaultRegistry } from './runtimes/default-registry.js';
import { autoModelCandidates, modelChoiceLabel } from './runtimes/model-selection.js';
import {
  RuntimeOrchestrator,
  workflowProgress,
  type RuntimeWorkflowState,
} from './runtimes/runtime-orchestrator.js';
import { StateStore } from './state-store.js';
import { roles } from './roles.js';
import { createApprover, type ApprovalMode } from './approval.js';
import { validateProjectRoot } from './project-context.js';
import {
  formatDuration,
  panel,
  renderBanner,
  renderDashboard,
  resolveTheme,
  statusBadge,
  THEME_NAMES,
  truncateVisible,
  type Theme,
} from './ui/ascii.js';
import {
  renderActivityView,
  renderAgentView,
  renderGoalView,
  renderHelpView,
} from './ui/inspect.js';
import {
  INITIAL_UI_STATE,
  parseTerminalInput,
  reduceUiEvent,
  type UiState,
} from './ui/interactive.js';
import { loadConfig, resetConfig, setConfigValue, type CliConfig } from './config.js';
import { appendRunRecord, listRunRecords, type RunRecord } from './history.js';
import { runDoctor } from './doctor.js';
import { writeReport } from './report.js';
import { providerPresets } from './providers/catalog.js';
import {
  addCustom,
  addPreset,
  listProviders,
  providersView,
  removeProvider,
  setKey,
  testProvider,
} from './providers/store.js';

const { version: VERSION } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};

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
  .option(
    '--runtime-terminal',
    'show controlled real-runtime output in terminal windows (default)',
    true,
  )
  .option('--no-runtime-terminal', 'run real-runtime processes headlessly');

function options(): {
  root: string;
  runtimeId?: string;
  model?: string;
  approval: ApprovalMode;
  runtimeTerminal: boolean;
  maxAgentAttempts: number;
  retryBackoffMs: number;
  maxFixAttempts: number;
  verbose: boolean;
  theme?: string;
} {
  const value = program.opts<{
    directory: string;
    runtime?: string;
    model?: string;
    approval: string;
    theme?: string;
    runtimeTerminal: boolean;
    agentAttempts: string;
    retryBackoffMs: string;
    fixAttempts: string;
    verbose?: boolean;
  }>();
  if (!['ask', 'always', 'never'].includes(value.approval))
    throw new Error('--approval must be ask, always, or never.');
  if (value.theme !== undefined) resolveTheme(value.theme);
  const maxAgentAttempts = Number.parseInt(value.agentAttempts, 10);
  const retryBackoffMs = Number.parseInt(value.retryBackoffMs, 10);
  const maxFixAttempts = Number.parseInt(value.fixAttempts, 10);
  if (maxAgentAttempts < 1 || retryBackoffMs < 0 || maxFixAttempts < 0)
    throw new Error('Retry counts must be non-negative; --agent-attempts must be at least 1.');
  return {
    root: path.resolve(value.directory),
    ...(value.runtime === undefined ? {} : { runtimeId: value.runtime }),
    ...(value.model === undefined ? {} : { model: value.model }),
    approval: value.approval as ApprovalMode,
    runtimeTerminal: value.runtimeTerminal,
    maxAgentAttempts,
    retryBackoffMs,
    maxFixAttempts,
    verbose: value.verbose ?? false,
    ...(value.theme === undefined ? {} : { theme: value.theme }),
  };
}

let sessionTheme: Theme | undefined;
function currentTheme(): Theme {
  return sessionTheme ?? resolveTheme(program.opts<{ theme?: string }>().theme);
}

async function prompt(question: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Interactive input is unavailable.');
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await reader.question(question)).trim();
  } finally {
    reader.close();
  }
}

// Reads a secret without echoing it back: stdin goes raw and typed characters
// are masked, so the key never reaches the scrollback.
async function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Interactive input is unavailable.');
  const input = process.stdin;
  process.stdout.write(question);
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const wasRaw: boolean = input.isRaw;
    input.setRawMode(true);
    input.resume();
    const cleanup = (): void => {
      input.setRawMode(wasRaw);
      input.pause();
      input.off('data', onData);
      process.stdout.write('\n');
    };
    const onData = (chunk: Buffer): void => {
      for (const byte of chunk) {
        if (byte === 0x03) {
          cleanup();
          reject(new Error('Cancelled.'));
          return;
        }
        if (byte === 0x0d || byte === 0x0a) {
          cleanup();
          resolve(value.trim());
          return;
        }
        if (byte === 0x7f || byte === 0x08) {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (byte < 0x20) continue;
        value += String.fromCharCode(byte);
        process.stdout.write('*');
      }
    };
    input.on('data', onData);
  });
}
async function choose(label: string, choices: { id: string; name: string }[]): Promise<string> {
  process.stdout.write(
    `${label}\n${choices.map((choice, index) => `  ${index + 1}) ${choice.name}`).join('\n')}\n`,
  );
  const answer = await prompt('Select a number: ');
  const index = Number.parseInt(answer, 10) - 1;
  const choice = choices[index];
  if (!choice) throw new Error('Invalid selection.');
  return choice.id;
}
async function resolveGoal(value?: string): Promise<string> {
  return value?.trim() || prompt('What should the AI development team build? ');
}
async function resolveRuntimeId(value?: string, root?: string): Promise<string> {
  if (value) return value;
  if (!process.stdin.isTTY)
    throw new Error('Choose a runtime with --runtime claude, opencode, or codex.');
  const stored = root === undefined ? [] : await listProviders(root);
  const addId = '__add-provider__';
  const selected = await choose('Choose a provider:', [
    { id: 'claude', name: 'Claude Code' },
    { id: 'opencode', name: 'OpenCode' },
    { id: 'codex', name: 'Codex' },
    ...stored.map((provider) => ({
      id: provider.id,
      name: `${provider.name} (API key, ${provider.protocol})`,
    })),
    { id: addId, name: 'Добавить провайдера (по API-ключу)…' },
  ]);
  if (selected === addId) {
    if (root === undefined) throw new Error('Project directory is required to add a provider.');
    return providerAddFlow(root, {});
  }
  return selected;
}
async function resolveModel(
  runtime: Awaited<ReturnType<typeof ensureRuntime>>,
  root: string,
  requested?: string,
): Promise<{ model?: string; models?: string[] }> {
  const discovery = await runtime.discoverModels(root);
  if (requested) {
    if (!discovery.models.includes(requested))
      throw new Error(`Model '${requested}' was not reported as available by ${runtime.name}.`);
    return { model: requested };
  }
  if (discovery.message) process.stdout.write(`${discovery.message}\n`);
  // Auto mode rotates through every provider, cheapest (free) models first.
  const candidates = autoModelCandidates(discovery);
  if (!process.stdin.isTTY) return candidates.length === 0 ? {} : { models: candidates };
  const selected = await choose('Choose a model:', [
    {
      id: 'auto',
      name:
        candidates.length === 0
          ? 'Auto (provider chooses and may switch models)'
          : `Auto (${candidates.length} models across all providers, free first)`,
    },
    ...discovery.models.map((model) => ({
      id: model,
      name: modelChoiceLabel(model, discovery),
    })),
  ]);
  if (selected !== 'auto') return { model: selected };
  return candidates.length === 0 ? {} : { models: candidates };
}

const LOW_VALUE_ACTIVITY = /(?:event:\s*)?(?:step_start|step_finish|tool_use)\b/i;
export function renderRuntimeState(
  state: RuntimeWorkflowState,
  root: string,
  verbose = false,
): string {
  const latest = new Map(state.events.map((event) => [event.roleId, event.status]));
  const progress = workflowProgress(state);
  const width = 20;
  const filled =
    progress.total === 0 ? 0 : Math.round((progress.completed / progress.total) * width);
  const event = [...state.events]
    .reverse()
    .find((candidate) => verbose || !LOW_VALUE_ACTIVITY.test(candidate.message));
  const attempt = event?.attempt ? `${event.attempt}/${event.maxAttempts ?? event.attempt}` : '-';
  const retry = [...state.events].reverse().find((candidate) => candidate.status === 'RETRYING');
  const lines = [
    `AI DEV TEAM  ${state.status}`,
    `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}] ${progress.completed}/${progress.total}`,
    `Path: ${root}`,
    `Model: ${state.model ?? 'runtime default'}`,
    `Phase: ${state.currentRoleId ?? (state.status === 'RUNNING' ? 'waiting' : 'complete')}  Attempt: ${attempt}`,
    ...roles.map((role) => `${role.name.padEnd(19)} ${latest.get(role.id) ?? 'WAITING'}`),
    `Latest: ${event ? `${event.roleId}: ${(event.message.split('\n')[0] ?? '').slice(0, 180)}` : 'Waiting'}`,
    `Retry: ${retry ? (retry.message.split('\n')[0] ?? '').slice(0, 180) : 'none'}`,
  ];
  if (state.status !== 'RUNNING') {
    const failures = state.events.filter((candidate) => candidate.status === 'FAILED');
    const failedRoles = [...new Set(failures.map((event) => event.roleId))];
    lines.push(
      `Summary: ${state.status === 'DONE' ? 'Implementation, verification, and review completed.' : `${failedRoles.length} agent(s) failed (${failedRoles.join(', ')}); inspect .ai-dev-team logs and retry after addressing the latest diagnostic.`}`,
    );
    const rootCause = failures.at(-1);
    if (rootCause !== undefined)
      lines.push(
        `Root cause: ${rootCause.roleId}: ${(rootCause.message.split('\n')[0] ?? '').slice(0, 480)}`,
      );
  }
  return lines.join('\n') + '\n';
}

let live = false;

const uiState: UiState = { ...INITIAL_UI_STATE };
let latestState: RuntimeWorkflowState | undefined;

function bannerHeight(): number {
  return renderBanner(currentTheme(), VERSION).split('\n').length - 1;
}

function paint(): void {
  const state = latestState;
  if (state === undefined) return;
  const config = options();
  const theme = currentTheme();
  const columns = process.stdout.columns;
  const rows = process.stdout.rows;
  const viewport = { width: columns, height: Math.max(6, rows) };
  let output: string;
  if (uiState.view.kind === 'dashboard') {
    uiState.hotspots.length = 0;
    const dashboard = renderDashboard(state, config.root, theme, {
      verbose: config.verbose,
      maxWidth: columns,
      hotspots: uiState.hotspots,
      offsetY: bannerHeight(),
    });
    output = `${renderBanner(theme, VERSION)}${dashboard}\n`;
  } else {
    const overlay =
      uiState.view.kind === 'goal'
        ? renderGoalView(state, theme, viewport, uiState.scroll)
        : uiState.view.kind === 'activity'
          ? renderActivityView(state, theme, viewport, uiState.scroll)
          : uiState.view.kind === 'agent'
            ? renderAgentView(state, uiState.view.roleId, theme, viewport, uiState.scroll)
            : renderHelpView(theme, viewport);
    output = overlay.lines.map((line) => truncateVisible(line, columns)).join('\n') + '\n';
  }
  process.stdout.write(`\x1B[H\x1B[2J${output}`);
}

// The live dashboard redraws in place on the alternate screen buffer (like
// htop): updates never accumulate in the scrollback, and the terminal content
// from before the run is restored when the run ends.
function render(state: RuntimeWorkflowState): void {
  latestState = state;
  if (!process.stdout.isTTY) return; // the final frame is printed once after the run
  if (!live) {
    process.stdout.write('\x1B[?1049h\x1B[?25l');
    live = true;
    attachInteractive();
  }
  paint();
}

/** Final frame printed once in the normal buffer as the persistent run record. */
function finalFrame(state: RuntimeWorkflowState): string {
  const theme = currentTheme();
  const dashboard = renderDashboard(state, options().root, theme, {
    verbose: options().verbose,
    maxWidth: process.stdout.columns,
  });
  return `${renderBanner(theme, VERSION)}${dashboard}\n`;
}

let interactiveAttached = false;

function handleTerminalInput(chunk: string): void {
  let changed = false;
  for (const event of parseTerminalInput(chunk)) {
    const next = reduceUiEvent(uiState, event, Math.max(1, process.stdout.rows - 4));
    if (next !== uiState) {
      uiState.view = next.view;
      uiState.scroll = next.scroll;
      changed = true;
    }
  }
  if (changed) paint();
}

function handleResize(): void {
  if (live) paint();
}

function attachInteractive(): void {
  if (interactiveAttached || !process.stdin.isTTY) return;
  interactiveAttached = true;
  // ?1000h enables button press reporting, ?1006h switches to SGR encoding so
  // coordinates are not limited to 223 columns.
  process.stdout.write('\x1B[?1000h\x1B[?1006h');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', handleTerminalInput);
  process.stdout.on('resize', handleResize);
}

function detachInteractive(): void {
  if (!interactiveAttached) return;
  interactiveAttached = false;
  process.stdout.write('\x1B[?1000l\x1B[?1006l');
  process.stdin.off('data', handleTerminalInput);
  process.stdout.off('resize', handleResize);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

/** Modal prompts (approval, install confirmation) need the plain cooked stdin. */
async function withInteractiveSuspended<T>(action: () => Promise<T>): Promise<T> {
  const wasLive = live;
  if (wasLive) {
    detachInteractive();
    process.stdout.write('\x1B[?25h\x1B[?1049l');
    live = false;
  }
  try {
    return await action();
  } finally {
    if (wasLive) {
      process.stdout.write('\x1B[?1049h\x1B[?25l');
      live = true;
      attachInteractive();
      paint();
    }
  }
}

function stopLive(): void {
  detachInteractive();
  if (!live) return;
  live = false;
  process.stdout.write('\x1B[?25h\x1B[?1049l');
}

process.on('exit', stopLive);

async function ensureRuntime(runtimeId: string, approval: ApprovalMode, root?: string) {
  const registry = await createDefaultRegistry({
    ...(root === undefined ? {} : { root }),
    approve: (command) => withInteractiveSuspended(() => createApprover(approval)(command)),
  });
  const runtime = registry.get(runtimeId);
  let detection = await runtime.detect();
  if (!detection.installed) {
    const instructions = runtime.getInstallInstructions();
    process.stdout.write(
      `${runtime.name} is not installed.\nOfficial method: ${instructions.command}\n${instructions.officialUrl}\n`,
    );
    if (!(await createApprover(approval)(instructions.command)))
      throw new Error('Runtime installation cancelled.');
    const installed = await runtime.install();
    if (!installed.success) throw new Error(installed.message);
    detection = await runtime.detect();
  }
  if (!detection.ready) {
    throw new Error(
      detection.message ||
        `${runtime.name} is installed but not ready. Authenticate it in its own CLI and retry.`,
    );
  }
  return runtime;
}
async function recordHistory(
  root: string,
  goal: string,
  state: RuntimeWorkflowState,
  model?: string,
): Promise<void> {
  try {
    const finishedAt = new Date().toISOString();
    const startedMs = state.startedAt ? Date.parse(state.startedAt) : Number.NaN;
    const record: RunRecord = {
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
  } catch (error) {
    process.stderr.write(
      `[ WARNING ] Could not record run history: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}
async function run(goal?: string): Promise<void> {
  const config = options();
  const saved = await loadConfig(config.root).catch((): CliConfig => ({}));
  sessionTheme = resolveTheme(config.theme ?? saved.theme);
  const approval =
    program.getOptionValueSource('approval') === 'cli'
      ? config.approval
      : ((saved.approval as ApprovalMode | undefined) ?? config.approval);
  await validateProjectRoot(config.root);
  const runtimeId = await resolveRuntimeId(config.runtimeId ?? saved.runtime, config.root);
  const runtime = await ensureRuntime(runtimeId, approval, config.root);
  const selection = await resolveModel(runtime, config.root, config.model ?? saved.model);
  const task = await resolveGoal(goal);
  if (!task) throw new Error('Task cannot be empty.');
  process.stdout.write(renderBanner(sessionTheme, VERSION));
  const store = new StateStore(config.root);
  // The dashboard must feel instant, so every state publication repaints the
  // screen immediately. Persisting to disk runs through a small throttle
  // instead (plus always on terminal states), because each save fsyncs
  // several JSON files and would otherwise run many times per second.
  const PERSIST_INTERVAL_MS = 1_000;
  let lastPersistedAt = 0;
  let lastPersistedStatus: RuntimeWorkflowState['status'] = 'RUNNING';
  const persist = async (state: RuntimeWorkflowState): Promise<void> => {
    const terminal = state.status !== 'RUNNING';
    const due =
      terminal ||
      lastPersistedStatus !== state.status ||
      Date.now() - lastPersistedAt >= PERSIST_INTERVAL_MS;
    if (!due) return;
    lastPersistedAt = Date.now();
    lastPersistedStatus = state.status;
    await store.save(state);
  };
  const orchestrator = new RuntimeOrchestrator({
    root: config.root,
    runtime,
    ...(selection.model === undefined ? {} : { model: selection.model }),
    ...(selection.models === undefined ? {} : { models: selection.models }),
    visibleRuntime: config.runtimeTerminal && runtime.id !== 'mock',
    maxAgentAttempts: config.maxAgentAttempts,
    retryBackoffMs: config.retryBackoffMs,
    maxFixAttempts: config.maxFixAttempts,
    onState: async (state) => {
      render(state);
      await persist(state);
    },
    onStateError: (error) => {
      process.stderr.write(
        `[ WARNING ] State persistence failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    },
  });
  let state: RuntimeWorkflowState;
  try {
    state = await orchestrator.run(task);
  } finally {
    stopLive();
  }
  // Leave one final frame in the normal buffer as the persistent run record.
  process.stdout.write(finalFrame(state));
  await recordHistory(config.root, task, state, selection.model);
  process.exitCode = state.status === 'DONE' ? 0 : 1;
}

program
  .argument('[task...]', 'development task')
  .action(async (task: string[]) => run(task.join(' ')));
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
  .action(async (task: string[]) => run(task.join(' ')));
program
  .command('resume')
  .description('Restart the persisted goal.')
  .action(async () => {
    const state = await new StateStore(options().root).load();
    if (!state) throw new Error('No saved workflow.');
    await run(state.goal);
  });
program
  .command('status')
  .description('Show persisted status.')
  .action(async () => {
    const state = await new StateStore(options().root).load();
    if (!state) throw new Error('No saved workflow.');
    process.stdout.write(finalFrame(state));
  });
program
  .command('agents')
  .description('List roles.')
  .action(() => {
    process.stdout.write(
      panel(
        'Agents',
        roles.map((role) => ` ▸ ${role.name.padEnd(19)} ${role.description}`),
        currentTheme(),
      ) + '\n',
    );
  });
interface AddProviderFlags {
  preset?: string;
  custom?: boolean;
  id?: string;
  name?: string;
  protocol?: string;
  baseUrl?: string;
  models?: string;
  apiKeyEnv?: string;
  key?: string;
}

// Shared add flow used by `providers add` (interactive or flag-driven) and by
// the "Add provider…" entry in the runtime chooser. Returns the new provider id.
async function providerAddFlow(root: string, flags: AddProviderFlags): Promise<string> {
  if (flags.custom) {
    if (!flags.id || !flags.name || !flags.protocol || !flags.baseUrl || !flags.models)
      throw new Error(
        'Custom providers need --id, --name, --protocol, --base-url, and --models.',
      );
    const models = flags.models
      .split(',')
      .map((model) => model.trim())
      .filter((model) => model !== '');
    const provider = await addCustom(
      root,
      {
        id: flags.id,
        name: flags.name,
        protocol: flags.protocol,
        baseUrl: flags.baseUrl,
        models,
        ...(flags.apiKeyEnv === undefined ? {} : { apiKeyEnv: flags.apiKeyEnv }),
      },
      flags.key,
    );
    process.stdout.write(`[ DONE ] Added provider '${provider.id}' (${provider.protocol}).\n`);
    return provider.id;
  }
  if (flags.preset) {
    const provider = await addPreset(root, flags.preset, flags.key);
    process.stdout.write(`[ DONE ] Added provider '${provider.id}' (${provider.protocol}).\n`);
    return provider.id;
  }
  const kind = await choose('Add a provider:', [
    { id: 'preset', name: 'Preset from the built-in catalog' },
    { id: 'custom', name: 'Custom OpenAI-compatible or Anthropic endpoint' },
  ]);
  if (kind === 'preset') {
    const presetId = await choose(
      'Choose a preset:',
      providerPresets.map((preset) => ({
        id: preset.id,
        name: `${preset.name} (${preset.apiKeyEnv})`,
      })),
    );
    const key = await promptSecret('API key (leave empty to skip, input hidden): ');
    const provider = await addPreset(root, presetId, key === '' ? undefined : key);
    process.stdout.write(`[ DONE ] Added provider '${provider.id}' (${provider.protocol}).\n`);
    return provider.id;
  }
  const id = await prompt('Provider id (lowercase, e.g. mycorp): ');
  const name = await prompt('Display name: ');
  const protocol = await choose('Protocol:', [
    { id: 'openai', name: 'OpenAI-compatible Chat Completions' },
    { id: 'anthropic', name: 'Anthropic Messages API' },
  ]);
  const baseUrl = await prompt('Base URL (OpenAI: include /v1; Anthropic: without /v1): ');
  const models = (await prompt('Models (comma-separated): '))
    .split(',')
    .map((model) => model.trim())
    .filter((model) => model !== '');
  const apiKeyEnv = await prompt('Environment variable for the key (optional): ');
  const key = await promptSecret('API key (leave empty to skip, input hidden): ');
  const provider = await addCustom(
    root,
    { id, name, protocol, baseUrl, models, ...(apiKeyEnv === '' ? {} : { apiKeyEnv }) },
    key === '' ? undefined : key,
  );
  process.stdout.write(`[ DONE ] Added provider '${provider.id}' (${provider.protocol}).\n`);
  return provider.id;
}

async function listProvidersAction(): Promise<void> {
  const views = await providersView(options().root);
  if (views.length === 0) {
    process.stdout.write(
      `No providers configured yet. Add one with: ai-dev-team providers add\nAvailable presets: ${providerPresets
        .map((preset) => `${preset.id} (${preset.apiKeyEnv})`)
        .join(', ')}\n`,
    );
    return;
  }
  const rows = views.map((view) => {
    const source = view.keySource === 'env' ? `env:${view.apiKeyEnv ?? '?'}` : view.keySource;
    const masked = view.maskedKey ?? '-';
    return [view.id, view.name, view.protocol, view.baseUrl, `${source}  ${masked}`];
  });
  const header = ['id', 'name', 'protocol', 'baseUrl', 'key'];
  const widths = header.map((column, index) =>
    Math.max(column.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const line = (columns: string[]): string =>
    columns.map((column, index) => column.padEnd(widths[index] ?? 0)).join('  ').trimEnd();
  process.stdout.write(`${line(header)}\n${line(widths.map((width) => '-'.repeat(width)))}\n`);
  for (const row of rows) process.stdout.write(`${line(row)}\n`);
}

const providers = program
  .command('providers')
  .description('Manage API-key LLM providers (presets and custom endpoints).')
  .action(async () => listProvidersAction());
providers
  .command('list')
  .description('Show providers with masked keys only.')
  .action(async () => listProvidersAction());
providers
  .command('add')
  .description('Add a provider from a preset or a custom endpoint definition.')
  .option('--preset <id>', 'preset id from the built-in catalog')
  .option('--custom', 'define a custom endpoint')
  .option('--id <id>', 'provider id for --custom')
  .option('--name <name>', 'display name for --custom')
  .option('--protocol <protocol>', 'openai or anthropic (for --custom)')
  .option('--base-url <url>', 'API base URL (for --custom)')
  .option('--models <list>', 'comma-separated model ids (for --custom)')
  .option('--api-key-env <var>', 'environment variable that supplies the key')
  .option('--key <key>', 'API key to store (prefer the interactive hidden prompt)')
  .action(async (flags: AddProviderFlags) => {
    await providerAddFlow(options().root, flags);
  });
providers
  .command('remove <id>')
  .description('Remove a provider and its stored key.')
  .action(async (id: string) => {
    await removeProvider(options().root, id);
    process.stdout.write(`[ DONE ] Removed provider '${id}'.\n`);
  });
providers
  .command('set-key <id>')
  .description('Store an API key for a provider (hidden prompt, or --key).')
  .option('--key <key>', 'API key value (non-interactive)')
  .action(async (id: string, flags: { key?: string }) => {
    const key = flags.key ?? (await promptSecret(`API key for '${id}' (input hidden): `));
    if (key === '') throw new Error('API key cannot be empty.');
    await setKey(options().root, id, key);
    process.stdout.write(`[ DONE ] Stored key for '${id}'.\n`);
  });
providers
  .command('test <id>')
  .description('Send a minimal request to verify the provider and its key.')
  .action(async (id: string) => {
    const result = await testProvider(options().root, id);
    process.stdout.write(`${result.ok ? '[ OK ]' : '[FAIL]'} ${result.message}\n`);
    if (!result.ok) process.exitCode = 1;
  });
program
  .command('runtimes')
  .description('Detect coding runtimes.')
  .action(async () => {
    process.stdout.write('RUNTIME STATUS\n--------------\n');
    for (const runtime of (await createDefaultRegistry({ root: options().root })).list()) {
      const result = await runtime.detect();
      process.stdout.write(
        `${runtime.name.padEnd(16)} ${result.ready ? 'READY' : result.installed ? 'NOT READY' : 'NOT INSTALLED'}${result.version ? `  ${result.version}` : ''}\n`,
      );
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
    process.stdout.write(
      failures.length === 0
        ? theme.success('\nAll checks passed.\n')
        : theme.failure(`\n${failures.length} check(s) need attention.\n`),
    );
    if (failures.length > 0) process.exitCode = 1;
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
    if (!state) throw new Error('No saved workflow.');
    const file = await writeReport(config.root, state);
    process.stdout.write(`[ DONE ] Report written to ${file}\n`);
  });
program
  .command('config [args...]')
  .description('Show or set persistent defaults: runtime, model, approval, theme.')
  .action(async (args: string[]) => {
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
        process.stdout.write(
          'No defaults configured. Example: ai-dev-team config set runtime claude\n',
        );
        return;
      }
      for (const [name, entry] of entries) process.stdout.write(`${name} = ${entry}\n`);
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
  .action(async (commandOptions: { yes?: boolean }) => {
    const config = options();
    const directory = new StateStore(config.root).directory;
    if (!commandOptions.yes) {
      if (!process.stdin.isTTY) throw new Error('Re-run with --yes to clean without a terminal.');
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
    const runtime = await ensureRuntime(
      await resolveRuntimeId(config.runtimeId, config.root),
      config.approval,
      config.root,
    );
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
    if (!state) throw new Error('No saved workflow.');
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
    if (!state) throw new Error('No saved workflow.');
    for (const event of state.events)
      process.stdout.write(`${event.roleId} [ ${event.status} ] ${event.message}\n`);
  });
program.parseAsync().catch((error: unknown) => {
  process.stderr.write(`[ FAILED ] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
