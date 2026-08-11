import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildLogFollowerOptions } from '../../terminal/log-follower.js';
import type { TerminalLauncher } from '../../terminal/terminal.js';
import { runProcess, type ProcessRunner } from '../process.js';
import type {
  AgentRequest,
  AuthResult,
  CodingRuntime,
  InstallInstructions,
  InstallResult,
  LaunchOptions,
  RuntimeDetection,
  RuntimeResult,
  RuntimeSession,
  RuntimeState,
} from '../runtime.js';

interface OpenCodeEvent {
  type?: unknown;
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
  return firstString(
    typeof event.error === 'string' ? event.error : undefined,
    error?.message,
    error?.name,
  );
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

export function buildOpenCodeRunArgs(request: AgentRequest): string[] {
  const args = ['run', '--format', 'json'];
  if (request.model) args.push('--model', request.model);
  if (request.resumeSessionId) args.push('--session', request.resumeSessionId);
  args.push(request.prompt);
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

  async discoverModels(workingDirectory: string): Promise<{ models: string[]; message?: string }> {
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
      return {
        models,
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
        `[ ACTIVE ] OpenCode ${options.roleId} controlled process output\n`,
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
    };

    const readOnlyConfig =
      request.toolPolicy === 'read-only'
        ? JSON.stringify({ permission: { bash: 'deny', edit: 'deny' } })
        : undefined;
    const previousConfig = process.env.OPENCODE_CONFIG_CONTENT;
    if (readOnlyConfig !== undefined) process.env.OPENCODE_CONFIG_CONTENT = readOnlyConfig;

    try {
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
          const text = activity.text ?? '';
          if (session.outputFile && text) await appendFile(session.outputFile, text, 'utf8');
          const meaningful = this.#activityText(text);
          if (meaningful) await request.onActivity?.({ type: 'output', message: meaningful });
        },
      );
      if (session.outputFile) {
        await appendFile(
          session.outputFile,
          `\n[ ${result.code === 0 ? 'COMPLETED' : 'FAILED'} ] Controlled OpenCode process exited with code ${result.code}.\n`,
          'utf8',
        );
      }
      if (result.code !== 0) {
        session.status = 'failed';
        const detail = (result.stderr || result.stdout).trim();
        return {
          success: false,
          output: detail || `OpenCode exited with code ${result.code}.`,
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
