import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildLogFollowerOptions } from '../../terminal/log-follower.js';
import type { TerminalLauncher } from '../../terminal/terminal.js';
import { runProcess, type ProcessResult, type ProcessRunner } from '../process.js';
import type {
  AgentRequest,
  AuthResult,
  CodingRuntime,
  InstallInstructions,
  InstallResult,
  LaunchOptions,
  RuntimeDetection,
  RuntimeModelDiscovery,
  RuntimeResult,
  RuntimeSession,
  RuntimeState,
} from '../runtime.js';

interface OpenCodeEvent {
  type?: unknown;
  timestamp?: unknown;
  sessionID?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
  text?: unknown;
  message?: unknown;
  error?: unknown;
  part?: unknown;
  data?: unknown;
}

export interface OpenCodeJsonResult {
  output: string;
  sessionId?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function eventSessionId(event: OpenCodeEvent): string | undefined {
  const part = asRecord(event.part);
  const data = asRecord(event.data);
  return firstString(
    event.sessionID,
    event.sessionId,
    event.session_id,
    part?.sessionID,
    part?.sessionId,
    data?.sessionID,
    data?.sessionId,
  );
}

function eventText(event: OpenCodeEvent): string | undefined {
  const part = asRecord(event.part);
  const data = asRecord(event.data);
  const message = asRecord(event.message);
  return firstString(event.text, part?.text, data?.text, message?.text);
}

function eventError(event: OpenCodeEvent): string | undefined {
  const error = asRecord(event.error);
  if (typeof event.error === 'string') return event.error;
  if (error === undefined) return undefined;
  // Provider errors nest the useful payload under `data` (e.g. OpenCode
  // APIError -> data.message, data.statusCode); a bare error.name like
  // "APIError" alone is not actionable.
  const name = firstString(error.name);
  const detail = firstString(error.message, asRecord(error.data)?.message);
  const statusCode = asRecord(error.data)?.statusCode;
  const status = typeof statusCode === 'number' ? ` (HTTP ${statusCode})` : '';
  if (detail === undefined && name === undefined) return undefined;
  if (detail === undefined) return `${name ?? 'Unknown error'}${status}`;
  // Keep plain messages untouched (backwards-compatible summaries); attach the
  // error class and HTTP status only when a provider status code is present.
  return status === '' ? detail : `${name ?? 'API error'}${status}: ${detail}`;
}

/** Builds a readable failure message from an OpenCode JSON event stream. */
export function summarizeOpenCodeFailure(result: ProcessResult): string {
  const messages: string[] = [];
  for (const line of result.stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = asRecord(JSON.parse(trimmed) as unknown) as OpenCodeEvent | undefined;
      if (!event) continue;
      const message = eventError(event) ?? eventText(event);
      if (message !== undefined) messages.push(message);
    } catch {
      // Not a JSON event line; skip it.
    }
  }
  const detail = [...new Set(messages)].join(' ').replaceAll(/\s+/gu, ' ').trim();
  if (detail) return `OpenCode exited with code ${result.code}: ${detail.slice(0, 400)}`;
  return (
    (result.stderr || result.stdout).trim().slice(0, 400) ||
    `OpenCode exited with code ${result.code}.`
  );
}

/**
 * Formats one streamed output line for the human-readable session log shown in
 * the separate runtime window. JSON events become `[HH:MM:SS] type: detail`;
 * anything else is kept verbatim so diagnostics are never lost.
 */
export function formatOpenCodeLogLine(
  line: string,
  prefix = '',
  now = new Date(),
): string | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const event = asRecord(JSON.parse(trimmed) as unknown) as OpenCodeEvent | undefined;
    if (!event) return `${prefix}${trimmed}`;
    const stamp = typeof event.timestamp === 'number' ? new Date(event.timestamp) : now;
    const time = stamp.toLocaleTimeString('en-GB', { hour12: false });
    const part = asRecord(event.part);
    const detail =
      eventText(event) ??
      eventError(event) ??
      firstString(typeof part?.type === 'string' ? part.type : undefined);
    const label = firstString(typeof event.type === 'string' ? event.type : undefined) ?? 'event';
    const body = detail === undefined ? label : `${label}: ${detail.replaceAll(/\s+/gu, ' ').trim()}`;
    return `${prefix}[${time}] ${body}`;
  } catch {
    return `${prefix}${trimmed}`;
  }
}

export function parseOpenCodeJsonEvents(stdout: string): OpenCodeJsonResult {
  const source = stdout.trim();
  if (!source) throw new Error('OpenCode returned an empty JSON event stream.');

  const values: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(source);
    if (Array.isArray(parsed)) {
      for (const value of parsed as unknown[]) values.push(value);
    } else {
      values.push(parsed);
    }
  } catch {
    for (const [index, line] of source.split(/\r?\n/u).entries()) {
      if (!line.trim()) continue;
      try {
        values.push(JSON.parse(line) as unknown);
      } catch {
        throw new Error(`OpenCode returned invalid JSON on event line ${index + 1}.`);
      }
    }
  }

  let sessionId: string | undefined;
  const text: string[] = [];
  const errors: string[] = [];
  for (const value of values) {
    const event = asRecord(value) as OpenCodeEvent | undefined;
    if (!event) continue;
    sessionId = eventSessionId(event) ?? sessionId;
    const content = eventText(event);
    if (content !== undefined) text.push(content);
    const error = eventError(event);
    if (error !== undefined) errors.push(error);
  }

  if (text.length === 0) {
    const detail = errors.length > 0 ? ` ${errors.join(' ')}` : '';
    throw new Error(`OpenCode JSON event stream contained no textual result.${detail}`);
  }
  return { output: text.join(''), ...(sessionId === undefined ? {} : { sessionId }) };
}

export interface OpenCodeModelInfo {
  id: string;
  free: boolean;
}

function countBraces(text: string): number {
  let depth = 0;
  for (const character of text) {
    if (character === '{') depth += 1;
    else if (character === '}') depth -= 1;
  }
  return depth;
}

/**
 * Parses `opencode models --verbose` output: each model is a `provider/id`
 * header line followed by a pretty-printed JSON metadata block whose `cost`
 * fields reveal whether the model runs for free.
 */
export function parseOpenCodeVerboseModels(stdout: string): OpenCodeModelInfo[] {
  const models: OpenCodeModelInfo[] = [];
  let currentId: string | undefined;
  let collecting = false;
  let depth = 0;
  const buffer: string[] = [];
  // Metadata is pretty-printed but not guaranteed strict JSON (trailing
  // commas appear between fields), so fall back to a tolerant re-parse.
  const flush = (): void => {
    if (currentId === undefined || buffer.length === 0) return;
    let meta: Record<string, unknown> | undefined;
    for (const text of [buffer.join('\n'), buffer.join('\n').replace(/,\s*([}\]])/gu, '$1')]) {
      try {
        meta = asRecord(JSON.parse(text) as unknown);
        break;
      } catch {
        // Try the next normalization before giving up on this block.
      }
    }
    if (meta === undefined) return;
    const cost = asRecord(meta.cost);
    const zeroCost =
      typeof cost?.input === 'number' &&
      typeof cost.output === 'number' &&
      cost.input === 0 &&
      cost.output === 0;
    // Zero cost alone is unreliable: custom providers without published
    // prices also report 0/0. Treat as free only OpenCode's own Zen tier
    // at zero cost or IDs explicitly suffixed "-free".
    const providerId = currentId.slice(0, Math.max(0, currentId.indexOf('/')));
    const free =
      /(?:^|[/_.-])free$/iu.test(currentId) || (providerId.toLowerCase() === 'opencode' && zeroCost);
    models.push({ id: currentId, free });
  };
  for (const line of stdout.split(/\r?\n/u)) {
    if (!collecting) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u.test(trimmed)) {
        currentId = trimmed;
        continue;
      }
      if (trimmed.startsWith('{') && currentId !== undefined) {
        buffer.length = 0;
        buffer.push(line);
        depth = countBraces(line);
        collecting = true;
        if (depth <= 0) {
          // Single-line JSON block: complete immediately.
          flush();
          buffer.length = 0;
          collecting = false;
        }
      }
      continue;
    }
    buffer.push(line);
    depth += countBraces(line);
    if (depth > 0) continue;
    collecting = false;
    flush();
    buffer.length = 0;
  }
  return models;
}

export function buildOpenCodeRunArgs(request: AgentRequest): string[] {
  // The prompt itself is piped through stdin (see execute): Windows cmd.exe
  // shims reject command lines longer than 8191 characters.
  const args = ['run', '--format', 'json'];
  if (request.toolPolicy === 'coding') args.push('--agent', 'build', '--auto');
  if (request.model) args.push('--model', request.model);
  if (request.resumeSessionId) args.push('--session', request.resumeSessionId);
  return args;
}

export class OpenCodeRuntime implements CodingRuntime {
  readonly id = 'opencode';
  readonly name = 'OpenCode';
  readonly #terminal: TerminalLauncher;
  readonly #run: ProcessRunner;
  readonly #sessions = new Map<string, RuntimeSession>();
  readonly #runtimeSessionIds = new Map<string, string>();

  constructor(terminal: TerminalLauncher, processRunner: ProcessRunner = runProcess) {
    this.#terminal = terminal;
    this.#run = processRunner;
  }

  async detect(): Promise<RuntimeDetection> {
    try {
      const result = await this.#run('opencode', ['--version'], process.cwd(), 10_000);
      if (result.code !== 0) {
        return {
          installed: true,
          ready: false,
          authenticated: 'unknown',
          message: result.stderr.trim() || `OpenCode exited with code ${result.code}.`,
        };
      }
      const versionOutput = result.stdout.trim() || result.stderr.trim();
      const version = /\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/u.exec(versionOutput)?.[1];
      return {
        installed: true,
        ready: true,
        authenticated: 'unknown',
        ...(version === undefined ? {} : { version }),
        ...(version === undefined && versionOutput ? { message: versionOutput } : {}),
      };
    } catch {
      return {
        installed: false,
        ready: false,
        authenticated: 'unknown',
        message: 'OpenCode command was not found.',
      };
    }
  }

  getInstallInstructions(): InstallInstructions {
    return {
      command: 'npm install -g opencode-ai',
      description: 'Official npm installation for OpenCode stable.',
      officialUrl: 'https://opencode.ai/docs/',
    };
  }

  async install(): Promise<InstallResult> {
    try {
      const result = await this.#run(
        'npm',
        ['install', '-g', 'opencode-ai'],
        process.cwd(),
        300_000,
      );
      return {
        success: result.code === 0,
        message: (result.stdout || result.stderr).trim() || `npm exited with code ${result.code}.`,
      };
    } catch (error) {
      return {
        success: false,
        message: `OpenCode installation failed: ${this.#errorMessage(error)}`,
      };
    }
  }

  async authenticate(workingDirectory: string): Promise<AuthResult> {
    await this.#terminal.open({
      cwd: workingDirectory,
      command: 'opencode',
      args: [workingDirectory],
      title: 'OpenCode Authentication',
    });
    return {
      success: true,
      message: 'OpenCode opened. Configure a provider and complete authentication in its terminal.',
    };
  }

  async discoverModels(workingDirectory: string): Promise<RuntimeModelDiscovery> {
    try {
      const result = await this.#run(
        'opencode',
        ['models', '--verbose'],
        workingDirectory,
        60_000,
      );
      if (result.code !== 0) {
        return {
          models: [],
          message: (result.stderr || result.stdout).trim() || 'OpenCode model discovery failed.',
        };
      }
      const infos = parseOpenCodeVerboseModels(result.stdout);
      if (infos.length === 0) return await this.#discoverModelsPlain(workingDirectory);
      const models = [...new Set(infos.map((info) => info.id))];
      const freeModels = infos.filter((info) => info.free).map((info) => info.id);
      return {
        models,
        ...(freeModels.length === 0 ? {} : { freeModels }),
        ...(models.length === 0
          ? { message: 'OpenCode reported no models. Configure and authenticate a provider first.' }
          : {}),
      };
    } catch (error) {
      return {
        models: [],
        message: `OpenCode model discovery failed: ${this.#errorMessage(error)}`,
      };
    }
  }

  /** Fallback for CLIs without `--verbose`: plain model ID listing. */
  async #discoverModelsPlain(workingDirectory: string): Promise<RuntimeModelDiscovery> {
    try {
      const result = await this.#run('opencode', ['models'], workingDirectory, 30_000);
      if (result.code !== 0) {
        return {
          models: [],
          message: (result.stderr || result.stdout).trim() || 'OpenCode model discovery failed.',
        };
      }
      const models = [
        ...new Set(
          result.stdout
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .filter(Boolean),
        ),
      ];
      // IDs ending in "-free" are OpenCode's zero-cost tier.
      const freeModels = models.filter((model) => /-free$/iu.test(model));
      return {
        models,
        ...(freeModels.length === 0 ? {} : { freeModels }),
        ...(models.length === 0
          ? { message: 'OpenCode reported no models. Configure and authenticate a provider first.' }
          : {}),
      };
    } catch (error) {
      return {
        models: [],
        message: `OpenCode model discovery failed: ${this.#errorMessage(error)}`,
      };
    }
  }

  async launch(options: LaunchOptions): Promise<RuntimeSession> {
    const session: RuntimeSession = {
      id: randomUUID(),
      runtimeId: this.id,
      roleId: options.roleId,
      workingDirectory: options.workingDirectory,
      status: 'running',
      createdAt: new Date().toISOString(),
    };
    if (options.visible) {
      const logsDirectory = path.join(options.workingDirectory, '.ai-dev-team', 'logs');
      await mkdir(logsDirectory, { recursive: true });
      session.outputFile = path.join(logsDirectory, `${session.id}-${options.roleId}.log`);
      await writeFile(
        session.outputFile,
        `[ ACTIVE ] OpenCode ${options.roleId} — live session log\nStarted: ${session.createdAt}\nProject: ${options.workingDirectory}\n\n`,
        'utf8',
      );
      try {
        const terminalProcess = await this.#terminal.open(
          buildLogFollowerOptions(
            options.workingDirectory,
            session.outputFile,
            this.name,
            options.roleId,
          ),
        );
        session.terminalOpened = true;
        if (terminalProcess.processId !== undefined) session.processId = terminalProcess.processId;
      } catch (error) {
        session.terminalError = this.#errorMessage(error);
      }
    }
    this.#sessions.set(session.id, session);
    return session;
  }

  async execute(session: RuntimeSession, request: AgentRequest): Promise<RuntimeResult> {
    session.status = 'running';
    const resumeSessionId = request.resumeSessionId ?? this.#runtimeSessionIds.get(session.id);
    const effectiveRequest: AgentRequest = {
      prompt: request.prompt,
      ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
      ...(request.model === undefined ? {} : { model: request.model }),
      ...(request.toolPolicy === undefined ? {} : { toolPolicy: request.toolPolicy }),
    };

    // Headless runs close stdin, and OpenCode auto-rejects every permission
    // prompt it cannot answer. Coding roles therefore run with --agent build
    // --auto (see buildOpenCodeRunArgs); read-only roles keep an explicit
    // deny config so they cannot modify the project.
    const readOnlyConfig =
      request.toolPolicy === 'read-only'
        ? JSON.stringify({ permission: { bash: 'deny', edit: 'deny' } })
        : undefined;
    const previousConfig = process.env.OPENCODE_CONFIG_CONTENT;
    if (readOnlyConfig !== undefined) process.env.OPENCODE_CONFIG_CONTENT = readOnlyConfig;

    try {
      // Streamed JSON events can split across pipe chunks; buffer the
      // incomplete tail so every log line is formatted exactly once.
      let pendingLog = '';
      const appendSessionLog = async (text: string, stream: 'stdout' | 'stderr'): Promise<void> => {
        if (!session.outputFile || text === '') return;
        pendingLog += text;
        const lines = pendingLog.split(/\r?\n/u);
        pendingLog = lines.pop() ?? '';
        const formatted = lines
          .map((line) => formatOpenCodeLogLine(line, stream === 'stderr' ? '[stderr] ' : ''))
          .filter((line): line is string => line !== undefined);
        if (formatted.length > 0)
          await appendFile(session.outputFile, `${formatted.join('\n')}\n`, 'utf8');
      };
      const flushSessionLog = async (): Promise<void> => {
        if (!session.outputFile || !pendingLog.trim()) return;
        const formatted = formatOpenCodeLogLine(pendingLog);
        pendingLog = '';
        if (formatted !== undefined)
          await appendFile(session.outputFile, `${formatted}\n`, 'utf8');
      };
      const result = await this.#run(
        'opencode',
        buildOpenCodeRunArgs(effectiveRequest),
        session.workingDirectory,
        undefined,
        async (activity) => {
          if (activity.type === 'started') {
            await request.onActivity?.({
              type: 'child-started',
              message: `OpenCode child process started${activity.processId === undefined ? '' : ` (PID ${activity.processId})`}.`,
              ...(activity.processId === undefined ? {} : { processId: activity.processId }),
            });
            return;
          }
          await appendSessionLog(activity.text ?? '', activity.type === 'stderr' ? 'stderr' : 'stdout');
          const meaningful = this.#activityText(activity.text ?? '');
          if (meaningful) await request.onActivity?.({ type: 'output', message: meaningful });
        },
        effectiveRequest.prompt,
      );
      await flushSessionLog();
      if (session.outputFile) {
        await appendFile(
          session.outputFile,
          `\n[ ${result.code === 0 ? 'COMPLETED' : 'FAILED'} ] Controlled OpenCode process exited with code ${result.code}.\n`,
          'utf8',
        );
      }
      if (result.code !== 0) {
        session.status = 'failed';
        return {
          success: false,
          output: summarizeOpenCodeFailure(result),
          exitCode: result.code,
        };
      }

      let parsed: OpenCodeJsonResult;
      try {
        parsed = parseOpenCodeJsonEvents(result.stdout);
      } catch (error) {
        session.status = 'failed';
        return { success: false, output: this.#errorMessage(error), exitCode: result.code };
      }
      session.status = 'completed';
      if (parsed.sessionId !== undefined) this.#runtimeSessionIds.set(session.id, parsed.sessionId);
      return {
        success: true,
        output: parsed.output,
        ...(parsed.sessionId === undefined ? {} : { sessionId: parsed.sessionId }),
        exitCode: result.code,
      };
    } catch (error) {
      session.status = 'failed';
      throw new Error(`OpenCode execution failed: ${this.#errorMessage(error)}`, { cause: error });
    } finally {
      if (readOnlyConfig !== undefined) {
        if (previousConfig === undefined) delete process.env.OPENCODE_CONFIG_CONTENT;
        else process.env.OPENCODE_CONFIG_CONTENT = previousConfig;
      }
    }
  }

  async pause(session: RuntimeSession): Promise<void> {
    session.status = 'paused';
  }
  async resume(session: RuntimeSession): Promise<void> {
    session.status = 'running';
  }
  async stop(session: RuntimeSession): Promise<void> {
    session.status = 'stopped';
  }
  async getStatus(session: RuntimeSession): Promise<RuntimeState> {
    return session.status;
  }

  #activityText(text: string): string | undefined {
    for (const line of text.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      try {
        const event = asRecord(JSON.parse(line) as unknown) as OpenCodeEvent | undefined;
        if (!event) continue;
        const content = eventText(event) ?? eventError(event);
        if (content) return content.replaceAll(/\s+/gu, ' ').trim().slice(0, 160);
        if (typeof event.type === 'string') return `OpenCode event: ${event.type}`;
      } catch {
        return line.replaceAll(/\s+/gu, ' ').trim().slice(0, 160);
      }
    }
    return undefined;
  }

  #errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
