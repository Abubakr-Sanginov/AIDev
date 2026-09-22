import { randomUUID } from 'node:crypto';
import type { StoredProvider } from '../../providers/store.js';
import { resolveKey } from '../../providers/store.js';
import { findPreset } from '../../providers/catalog.js';
import type { ToolContext } from '../../tools/index.js';
import * as toolsIndex from '../../tools/index.js';
import type {
  AgentRequest,
  AuthResult,
  CodingRuntime,
  InstallInstructions,
  InstallResult,
  LaunchOptions,
  RuntimeActivity,
  RuntimeDetection,
  RuntimeModelDiscovery,
  RuntimeResult,
  RuntimeSession,
  RuntimeState,
} from '../runtime.js';
import { callOpenAiChat, type OpenAiMessage } from './openai.js';
import { callAnthropicMessages, type AnthropicMessage } from './anthropic.js';
import {
  isMutatingTool,
  selectTools,
  toolsForProtocol,
  type NormalizedToolCall,
} from './tools.js';

export interface ApiRuntimeOptions {
  root: string;
  approve?: (command: string) => Promise<boolean>;
  fetchImpl?: typeof fetch;
  /** Backoff between transport-level retries for transient network errors. */
  transportDelaysMs?: readonly number[];
  requestTimeoutMs?: number;
}

interface ToolOutcome {
  content: string;
  isError: boolean;
}

const MAX_TOOL_OUTPUT_CHARS = 12_000;

async function report(
  request: AgentRequest,
  activity: RuntimeActivity,
): Promise<void> {
  await request.onActivity?.(activity);
}

/**
 * CodingRuntime backed by a stored provider definition (see providers/store).
 * It speaks either the OpenAI-compatible Chat Completions protocol or the
 * Anthropic Messages API over plain fetch — no vendor SDKs — and drives the
 * shared tool set from src/tools so API providers get the same sandboxing,
 * approval flow, and read-only policy as the CLI runtimes.
 */
export class ApiProviderRuntime implements CodingRuntime {
  readonly id: string;
  readonly name: string;
  readonly #provider: StoredProvider;
  readonly #root: string;
  readonly #approve: (command: string) => Promise<boolean>;
  readonly #fetchImpl?: typeof fetch;
  readonly #transportDelaysMs?: readonly number[];
  readonly #requestTimeoutMs?: number;
  readonly #sessions = new Map<string, RuntimeSession>();

  constructor(provider: StoredProvider, options: ApiRuntimeOptions) {
    this.#provider = provider;
    this.id = provider.id;
    this.name = provider.name;
    this.#root = options.root;
    this.#approve = options.approve ?? (async () => true);
    if (options.fetchImpl !== undefined) this.#fetchImpl = options.fetchImpl;
    if (options.transportDelaysMs !== undefined) this.#transportDelaysMs = options.transportDelaysMs;
    if (options.requestTimeoutMs !== undefined) this.#requestTimeoutMs = options.requestTimeoutMs;
  }

  async detect(): Promise<RuntimeDetection> {
    const resolution = await resolveKey(this.#root, this.id);
    const hint = `Add an API key with ai-dev-team providers set-key ${this.id}` +
      (this.#provider.apiKeyEnv ? ` or set ${this.#provider.apiKeyEnv}` : '');
    return {
      installed: true,
      ready: resolution.ok,
      authenticated: resolution.ok ? 'yes' : 'no',
      ...(resolution.ok ? {} : { message: hint }),
    };
  }

  getInstallInstructions(): InstallInstructions {
    return {
      command: `ai-dev-team providers set-key ${this.id}`,
      description: 'API-key providers need no installation, only an API key.',
      officialUrl: this.#provider.baseUrl,
    };
  }

  async install(): Promise<InstallResult> {
    return { success: true, message: 'API-key providers need no installation.' };
  }

  async authenticate(workingDirectory: string): Promise<AuthResult> {
    const resolution = await resolveKey(workingDirectory, this.id);
    return resolution.ok
      ? { success: true, message: `API key available from ${resolution.source}.` }
      : {
          success: false,
          message: `Add an API key with ai-dev-team providers set-key ${this.id}.`,
        };
  }

  async discoverModels(): Promise<RuntimeModelDiscovery> {
    const preset = this.#provider.preset ? findPreset(this.#provider.preset) : undefined;
    return {
      models: [...this.#provider.models],
      ...(preset?.freeModels ? { freeModels: [...preset.freeModels] } : {}),
    };
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
    this.#sessions.set(session.id, session);
    return session;
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
  async execute(session: RuntimeSession, request: AgentRequest): Promise<RuntimeResult> {
    session.status = 'running';
    try {
      const resolution = await resolveKey(this.#root, this.id);
      if (!resolution.ok) {
        const hint = `Add an API key with ai-dev-team providers set-key ${this.id}` +
          (this.#provider.apiKeyEnv ? ` or set ${this.#provider.apiKeyEnv}` : '');
        throw new Error(`No API key for provider '${this.id}'. ${hint}.`);
      }
      // allTools is a static dependency: zod ships as a regular dependency of
      // the CLI, so the tool layer is always available at runtime.
      const toolsModule = toolsIndex;
      const tools = selectTools(toolsModule.allTools, request.toolPolicy);
      // Token economy: a role with a zero tool budget (e.g. manager) gets no
      // tool schemas at all, so the model answers in one cheap completion.
      const schemas = request.maxToolCalls === 0
        ? []
        : toolsForProtocol(this.#provider.protocol, tools);
      const model = request.model ?? this.#provider.models[0] ?? 'default';
      // Soft budgets: near the ceiling the model is told to wrap up instead of
      // being cut off mid-work; only the safety ceilings force a hard stop.
      const softSteps = request.maxSteps ?? 10;
      const softCalls = request.maxToolCalls ?? Number.POSITIVE_INFINITY;
      const hardSteps = Math.max(softSteps * 4, 40);
      const hardCalls = Number.isFinite(softCalls)
        ? Math.max(softCalls * 5, 100)
        : 500;
      let toolCallsUsed = 0;
      let budgetWarned = false;
      const budgetWarning = (): string =>
        `Budget warning: you have used ${toolCallsUsed} tool calls (planned budget ${Number.isFinite(softCalls) ? softCalls : 'unlimited'}). ` +
        'Do not call any more tools unless strictly required: finish now with your final artifact ' +
        '(status, summary, decisions, files changed, commands run, risks, handoff).';
      await report(request, {
        type: 'output',
        message: `Sending request to ${this.name} (${this.#provider.protocol}, model ${model}).`,
      });
      const seenCalls = new Map<string, string>();
      const runTool = async (call: NormalizedToolCall): Promise<ToolOutcome> => {
        toolCallsUsed += 1;
        if (toolCallsUsed > hardCalls)
          return {
            content: 'Safety ceiling reached: too many tool calls. Finish with text now.',
            isError: true,
          };
        // Token economy: replay the cached result instead of re-executing an
        // identical call (same tool + same arguments).
        const signature = `${call.name}:${call.argumentsJson}`;
        const cached = seenCalls.get(signature);
        if (cached !== undefined) return { content: cached, isError: false };
        const tool = toolsModule.allTools.find(
          (candidate) => candidate.definition.name === call.name,
        );
        if (request.toolPolicy === 'read-only' && isMutatingTool(call.name))
          return { content: `Tool '${call.name}' is not allowed in read-only mode.`, isError: true };
        if (!tool)
          return { content: `Unknown tool '${call.name}'.`, isError: true };
        let input: unknown;
        try {
          input = call.argumentsJson === '' ? {} : (JSON.parse(call.argumentsJson) as unknown);
        } catch {
          return { content: `Invalid tool arguments JSON for '${call.name}'.`, isError: true };
        }
        await report(request, { type: 'output', message: `Tool call: ${call.name}` });
        const context: ToolContext = { root: session.workingDirectory, approve: this.#approve };
        const result = await toolsModule.executeTool(tool, input, context);
        const text = result.ok ? result.output : `Error: ${result.error ?? 'tool failed'}`;
        const content = text.slice(0, MAX_TOOL_OUTPUT_CHARS);
        if (result.ok && seenCalls.size < 200) seenCalls.set(signature, content);
        return { content, isError: !result.ok };
      };
      let finalText = '';
      if (this.#provider.protocol === 'openai') {
        const messages: OpenAiMessage[] = [
          { role: 'system', content: request.prompt },
          { role: 'user', content: 'Proceed with the task described in the system message.' },
        ];
        for (let step = 0; step < hardSteps; step++) {
          const { reply, assistantMessage } = await callOpenAiChat({
            baseUrl: this.#provider.baseUrl,
            apiKey: resolution.key,
            model,
            messages,
            tools: schemas,
            ...(this.#fetchImpl === undefined ? {} : { fetchImpl: this.#fetchImpl }),
            ...(this.#transportDelaysMs === undefined ? {} : { transportDelaysMs: this.#transportDelaysMs }),
            ...(this.#requestTimeoutMs === undefined ? {} : { timeoutMs: this.#requestTimeoutMs }),
          });
          messages.push(assistantMessage);
          if (reply.toolCalls.length === 0) {
            finalText = reply.text;
            break;
          }
          for (const call of reply.toolCalls) {
            const outcome = await runTool(call);
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: outcome.content,
            });
          }
          if (
            !budgetWarned &&
            (toolCallsUsed >= softCalls || step >= softSteps - 1)
          ) {
            budgetWarned = true;
            messages.push({ role: 'user', content: budgetWarning() });
          }
          if (step === hardSteps - 1)
            throw new Error(
              `Safety ceiling reached after ${hardSteps} steps without a final answer.`,
            );
        }
      } else {
        const messages: AnthropicMessage[] = [{ role: 'user', content: request.prompt }];
        for (let step = 0; step < hardSteps; step++) {
          const { reply, assistantContent } = await callAnthropicMessages({
            baseUrl: this.#provider.baseUrl,
            apiKey: resolution.key,
            model,
            system:
              'You are an autonomous software-engineering agent. Use the provided tools when you need to inspect or modify the project.',
            messages,
            tools: schemas,
            ...(this.#fetchImpl === undefined ? {} : { fetchImpl: this.#fetchImpl }),
            ...(this.#transportDelaysMs === undefined ? {} : { transportDelaysMs: this.#transportDelaysMs }),
            ...(this.#requestTimeoutMs === undefined ? {} : { timeoutMs: this.#requestTimeoutMs }),
          });
          messages.push({ role: 'assistant', content: assistantContent });
          if (reply.toolCalls.length === 0) {
            finalText = reply.text;
            break;
          }
          const results: Record<string, unknown>[] = [];
          for (const call of reply.toolCalls) {
            const outcome = await runTool(call);
            results.push({
              type: 'tool_result',
              tool_use_id: call.id,
              content: outcome.content,
              ...(outcome.isError ? { is_error: true } : {}),
            });
          }
          messages.push({ role: 'user', content: results });
          if (
            !budgetWarned &&
            (toolCallsUsed >= softCalls || step >= softSteps - 1)
          ) {
            budgetWarned = true;
            messages.push({ role: 'user', content: budgetWarning() });
          }
          if (step === hardSteps - 1)
            throw new Error(
              `Safety ceiling reached after ${hardSteps} steps without a final answer.`,
            );
        }
      }
      session.status = 'completed';
      return { success: true, output: finalText, sessionId: session.id, exitCode: 0 };
    } catch (error) {
      session.status = 'failed';
      throw error;
    }
  }

}

