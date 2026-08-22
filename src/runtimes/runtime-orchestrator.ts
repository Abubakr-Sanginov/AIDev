import { readdir } from 'node:fs/promises';
import type { CodingRuntime, RuntimeResult, RuntimeSession } from './runtime.js';
import { getRole, isReadOnlyRole, roles } from '../roles.js';
import { formatProjectContext, inspectProject, type ProjectContext } from '../project-context.js';

export type RuntimeWorkflowEventStatus =
  'RUNNING' | 'ACTIVE' | 'RETRYING' | 'DONE' | 'FAILED' | 'SKIPPED' | 'CANCELLED';

export interface RuntimeWorkflowEvent {
  roleId: string;
  status: RuntimeWorkflowEventStatus;
  message: string;
  timestamp?: string;
  attempt?: number;
  maxAttempts?: number;
}
export interface RuntimeWorkflowState {
  goal: string;
  runtimeId: string;
  status: 'RUNNING' | 'DONE' | 'FAILED';
  attempts: number;
  sessions: RuntimeSession[];
  events: RuntimeWorkflowEvent[];
  startedAt?: string;
  updatedAt?: string;
  completedPhases?: number;
  totalPhases?: number;
  currentRoleId?: string;
  projectContext?: ProjectContext;
}
export interface RuntimeWorkflowOptions {
  root: string;
  runtime: CodingRuntime;
  maxFixAttempts?: number;
  visibleRuntime?: boolean;
  heartbeatMs?: number;
  model?: string;
  maxAgentAttempts?: number;
  retryBackoffMs?: number;
  onState?(state: RuntimeWorkflowState): Promise<void> | void;
  onStateError?(error: unknown): Promise<void> | void;
}

export function workflowProgress(state: RuntimeWorkflowState): {
  completed: number;
  total: number;
} {
  return { completed: state.completedPhases ?? 0, total: state.totalPhases ?? 5 };
}

const FULL_STACK_SIGNAL = /full-?stack|фулл?-?стек|полный\s+стек/i;
const BACKEND_SIGNAL =
  /\bapi\b|backend|server|database|persistence|graphql|endpoint|rest-?ful|\bservice\b|\bbot\b|бэкенд|бекенд|сервер|база\s+данных|микросервис/i;
const FRONTEND_SIGNAL =
  /frontend|storefront|dashboard|user ?interface|\bui\b|client-?side|\bweb\b|website|web-?site|landing|portfolio|pages?\b|blog|e-?commerce|портфолио|сайт|лендинг|страниц|интерфейс|магазин|блог|витрин|фронтенд/i;
const FAIL_VERDICT = /VERDICT:\s*FAIL\b/i;
const PASS_VERDICT = /VERDICT:\s*PASS\b/i;
const DEFECT_FINDING = /\b(?:defects?|failures?|errors?|issues?)\s*:\s*(?!none\b|no\b|0\b)/i;
const NO_DEFECT_FINDING = /\b(?:no\s+(?:reproducible\s+)?defects?|defects?\s*:\s*(?:none|no|0))\b/i;

export class RuntimeOrchestrator {
  readonly #root: string;
  readonly #runtime: CodingRuntime;
  readonly #maxFixAttempts: number;
  readonly #visibleRuntime: boolean;
  readonly #heartbeatMs: number;
  readonly #model?: string;
  readonly #maxAgentAttempts: number;
  readonly #retryBackoffMs: number;
  readonly #onState: (state: RuntimeWorkflowState) => Promise<void> | void;
  readonly #onStateError: (error: unknown) => Promise<void> | void;
  #statePublication = Promise.resolve();
  #scheduledRoles: string[] = [];
  constructor(options: RuntimeWorkflowOptions) {
    this.#root = options.root;
    this.#runtime = options.runtime;
    this.#maxFixAttempts = options.maxFixAttempts ?? 2;
    this.#visibleRuntime = options.visibleRuntime ?? false;
    this.#heartbeatMs = options.heartbeatMs ?? 2_000;
    if (options.model !== undefined) this.#model = options.model;
    this.#maxAgentAttempts = Math.max(1, options.maxAgentAttempts ?? 3);
    this.#retryBackoffMs = Math.max(0, options.retryBackoffMs ?? 100);
    this.#onState = options.onState ?? (() => undefined);
    this.#onStateError = options.onStateError ?? (() => undefined);
  }

  async run(goal: string): Promise<RuntimeWorkflowState> {
    const projectContext = await inspectProject(this.#root);
    const projectSummary = formatProjectContext(projectContext);
    const now = new Date().toISOString();
    const implementationRoles = this.#implementationRoles(goal, projectContext);
    const skippedLayers = ['backend', 'frontend'].filter(
      (roleId) => !implementationRoles.includes(roleId),
    );
    this.#scheduledRoles = ['manager', 'architect', ...implementationRoles, 'tester', 'reviewer'];
    const state: RuntimeWorkflowState = {
      goal,
      runtimeId: this.#runtime.id,
      status: 'RUNNING',
      attempts: 0,
      sessions: [],
      events: [],
      startedAt: now,
      updatedAt: now,
      completedPhases: 0,
      totalPhases: this.#scheduledRoles.length,
      projectContext,
    };
    const artifacts: Record<string, string> = {};
    for (const roleId of skippedLayers) {
      artifacts[roleId] =
        `[SKIPPED ${roleId}] No matching project structure or manifest signal was detected.`;
      this.#event(
        state,
        roleId,
        'SKIPPED',
        'No matching project structure or manifest signal was detected.',
      );
    }
    const initialProjectArtifacts = await this.#projectArtifacts();
    const verifyArtifacts =
      initialProjectArtifacts === 0
        ? async (): Promise<string | undefined> =>
            (await this.#projectArtifacts()) === 0
              ? `No project artifacts exist in target directory ${this.#root}; the implementation role cannot be considered complete.`
              : undefined
        : undefined;
    artifacts.manager = await this.#safeExecute(
      'manager',
      `Target project directory: ${this.#root}\nexistingProject: ${projectContext.existingProject}\n${projectSummary}\n\nCustomer request:\n${goal}`,
      state,
      'Manager failed; continue from the customer request.',
    );
    artifacts.architect = await this.#safeExecute(
      'architect',
      this.#artifactHandoff(goal, artifacts, projectSummary),
      state,
      'Architecture unavailable; continue conservatively and report the gap.',
    );
    for (const roleId of implementationRoles)
      artifacts[roleId] = await this.#safeExecute(
        roleId,
        this.#artifactHandoff(goal, artifacts, projectSummary),
        state,
        `${roleId} failed; continue independent work and report the gap.`,
        verifyArtifacts,
      );
    let missingArtifacts = initialProjectArtifacts === 0 && (await this.#projectArtifacts()) === 0;
    if (missingArtifacts) {
      artifacts.artifactVerification =
        `VERDICT: FAIL - no project artifacts exist in target directory ${this.#root}. ` +
        'The implementation role cannot be considered complete.';
      await this.#publish(state);
    }
    artifacts.tester = await this.#safeExecute(
      'tester',
      this.#artifactHandoff(goal, artifacts, projectSummary),
      state,
      'Testing unavailable; Reviewer must report the verification gap.',
    );
    if (missingArtifacts)
      artifacts.tester = `${artifacts.tester}\n${artifacts.artifactVerification}`;
    if (this.#reportsDefects(artifacts.tester)) {
      for (let attempt = 0; attempt < this.#maxFixAttempts; attempt += 1) {
        state.attempts += 1;
        artifacts.fixer = await this.#safeExecute(
          'fixer',
          this.#artifactHandoff(goal, artifacts, projectSummary),
          state,
          'Fix failed; preserve defect for review.',
        );
        missingArtifacts = initialProjectArtifacts === 0 && (await this.#projectArtifacts()) === 0;
        if (missingArtifacts) {
          artifacts.artifactVerification = `VERDICT: FAIL - no project artifacts exist in target directory ${this.#root}.`;
        } else {
          delete artifacts.artifactVerification;
        }
        artifacts.tester = await this.#safeExecute(
          'tester',
          this.#artifactHandoff(goal, artifacts, projectSummary),
          state,
          'Retest unavailable; preserve verification gap.',
        );
        if (missingArtifacts) artifacts.tester += `\n${artifacts.artifactVerification}`;
        if (!this.#reportsDefects(artifacts.tester)) break;
      }
    }
    let review = '[SKIPPED reviewer] Verification prerequisites did not pass.';
    if (!this.#reportsDefects(artifacts.tester) && !artifacts.tester.startsWith('[UNAVAILABLE ')) {
      review = await this.#safeExecute(
        'reviewer',
        this.#artifactHandoff(goal, artifacts, projectSummary),
        state,
        'Review unavailable; workflow ended with diagnostic evidence.',
      );
    } else {
      this.#event(
        state,
        'reviewer',
        'SKIPPED',
        'Reviewer not scheduled because implementation verification did not pass.',
      );
    }
    state.status =
      !this.#reportsDefects(artifacts.tester) && this.#reviewApproved(review) ? 'DONE' : 'FAILED';
    delete state.currentRoleId;
    await this.#terminalize(state);
    await this.#publish(state);
    return state;
  }

  #implementationRoles(goal: string, projectContext: ProjectContext): string[] {
    const fullStack = FULL_STACK_SIGNAL.test(goal);
    const backend = fullStack || BACKEND_SIGNAL.test(goal) || projectContext.layers.backend;
    const frontend = fullStack || FRONTEND_SIGNAL.test(goal) || projectContext.layers.frontend;
    if (backend && frontend) return ['backend', 'frontend'];
    if (backend) return ['backend'];
    if (frontend) return ['frontend'];
    return ['coder'];
  }

  #reportsDefects(output: string): boolean {
    if (FAIL_VERDICT.test(output)) return true;
    if (PASS_VERDICT.test(output) || NO_DEFECT_FINDING.test(output)) return false;
    return DEFECT_FINDING.test(output);
  }

  #reviewApproved(output: string): boolean {
    return (
      !output.startsWith('[UNAVAILABLE ') &&
      !/\bCHANGES_REQUIRED\b/i.test(output) &&
      /\bAPPROVED\b|VERDICT:\s*PASS\b/i.test(output)
    );
  }

  async #safeExecute(
    roleId: string,
    prompt: string,
    state: RuntimeWorkflowState,
    fallback: string,
    verify?: () => Promise<string | undefined>,
  ): Promise<string> {
    let diagnostic = 'Unknown runtime failure';
    for (let attempt = 1; attempt <= this.#maxAgentAttempts; attempt += 1) {
      try {
        const diagnosticContext =
          attempt === 1
            ? ''
            : `\n\nRetry diagnostic: attempt ${attempt}/${this.#maxAgentAttempts}. Previous failure: ${diagnostic}. Resume the same ${roleId} stage; do not skip prerequisites.`;
        return (await this.#execute(roleId, prompt + diagnosticContext, state, attempt, verify))
          .output;
      } catch (error) {
        diagnostic = error instanceof Error ? error.message : String(error);
        if (attempt === this.#maxAgentAttempts) break;
        const delay = this.#retryBackoffMs * 2 ** (attempt - 1);
        state.status = 'RUNNING';
        state.currentRoleId = roleId;
        this.#event(
          state,
          roleId,
          'RETRYING',
          `Attempt ${attempt}/${this.#maxAgentAttempts} failed: ${diagnostic}. Retrying same stage in ${delay}ms.`,
          attempt,
          this.#maxAgentAttempts,
        );
        await this.#publish(state);
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    this.#event(
      state,
      roleId,
      'FAILED',
      `Retry limit exhausted (${this.#maxAgentAttempts} attempts): ${diagnostic}. ${fallback}`,
      this.#maxAgentAttempts,
      this.#maxAgentAttempts,
    );
    await this.#publish(state);
    return `[UNAVAILABLE ${roleId}] ${diagnostic}. ${fallback}`;
  }

  #artifactHandoff(
    goal: string,
    artifacts: Record<string, string>,
    projectSummary: string,
  ): string {
    const sections = Object.entries(artifacts).map(
      (entry) => `## ${entry[0]}\n${entry[1].slice(0, 6000)}`,
    );
    return `Target project directory: ${this.#root}\nAll filesystem and command operations MUST use this directory as the working directory.\n${projectSummary}\nGoal: ${goal}\nConcise upstream artifacts:\n${sections.join('\n')}`;
  }

  async #projectArtifacts(): Promise<number> {
    try {
      const entries = await readdir(this.#root, { withFileTypes: true });
      return entries.filter((entry) => !['.ai-dev-team', '.ai-team', '.git'].includes(entry.name))
        .length;
    } catch {
      return 0;
    }
  }

  async #terminalize(state: RuntimeWorkflowState): Promise<void> {
    for (const session of state.sessions) {
      if (
        session.status === 'running' ||
        session.status === 'starting' ||
        session.status === 'paused'
      ) {
        try {
          await this.#runtime.stop(session);
        } catch {
          session.status = 'stopped';
        }
      }
    }
    const latest = new Map<string, RuntimeWorkflowEvent>();
    for (const event of state.events) latest.set(event.roleId, event);
    for (const role of roles) {
      const event = latest.get(role.id);
      if (!event) {
        this.#event(state, role.id, 'SKIPPED', 'Agent was not scheduled for this workflow.');
      } else if (
        event.status === 'RUNNING' ||
        event.status === 'ACTIVE' ||
        event.status === 'RETRYING'
      ) {
        this.#event(state, role.id, 'CANCELLED', 'Outstanding agent cancelled at workflow end.');
      }
    }
  }

  async #execute(
    roleId: string,
    context: string,
    state: RuntimeWorkflowState,
    attempt = 1,
    verify?: () => Promise<string | undefined>,
  ): Promise<RuntimeResult> {
    const role = getRole(roleId);
    const session = await this.#runtime.launch({
      workingDirectory: this.#root,
      roleId,
      visible: this.#visibleRuntime,
    });
    state.sessions.push(session);
    state.currentRoleId = roleId;
    this.#event(
      state,
      roleId,
      'RUNNING',
      `${role.name} attempt ${attempt}/${this.#maxAgentAttempts} started.`,
      attempt,
      this.#maxAgentAttempts,
    );
    if (session.terminalOpened)
      this.#event(state, roleId, 'ACTIVE', `Runtime terminal opened for ${role.name}.`);
    if (session.terminalError)
      this.#event(
        state,
        roleId,
        'ACTIVE',
        `Warning: runtime terminal could not be opened: ${session.terminalError}`,
      );
    await this.#publish(state);
    const heartbeat = setInterval(() => {
      state.updatedAt = new Date().toISOString();
      void this.#publish(state);
    }, this.#heartbeatMs);
    let acceptingActivity = true;
    try {
      const result = await this.#runtime.execute(session, {
        prompt: `${role.systemPrompt}\n\nExecution budget: ${role.budget.maxSteps} steps and ${role.budget.maxToolCalls} tool calls.\n${context}`,
        maxSteps: role.budget.maxSteps,
        maxToolCalls: role.budget.maxToolCalls,
        toolPolicy: isReadOnlyRole(roleId) ? 'read-only' : 'coding',
        ...(this.#model === undefined ? {} : { model: this.#model }),
        onActivity: async (activity) => {
          if (!acceptingActivity || state.status !== 'RUNNING') return;
          this.#event(state, roleId, 'ACTIVE', activity.message);
          await this.#publish(state);
        },
      });
      acceptingActivity = false;
      clearInterval(heartbeat);
      if (!result.success)
        throw new Error(
          result.output.trim() || `Runtime exited with code ${result.exitCode ?? 'unknown'}.`,
        );
      if (verify !== undefined) {
        const problem = await verify();
        if (problem !== undefined) throw new Error(problem);
      }
      this.#event(state, roleId, 'DONE', result.output);
      state.completedPhases = new Set(
        state.events
          .filter((event) => event.status === 'DONE' && this.#scheduledRoles.includes(event.roleId))
          .map((event) => event.roleId),
      ).size;
      await this.#publish(state);
      return result;
    } catch (error) {
      acceptingActivity = false;
      clearInterval(heartbeat);
      try {
        await this.#runtime.stop(session);
      } catch {
        // Preserve the execution error; stop is best-effort cleanup.
      }
      session.status = 'failed';
      throw error;
    }
  }
  async #publish(state: RuntimeWorkflowState): Promise<void> {
    const snapshot = structuredClone(state);
    const publication = this.#statePublication.then(async () => {
      try {
        await this.#onState(snapshot);
      } catch (error) {
        try {
          await this.#onStateError(error);
        } catch {
          // Reporting must not crash execution.
        }
      }
    });
    this.#statePublication = publication;
    await publication;
  }
  #event(
    state: RuntimeWorkflowState,
    roleId: string,
    status: RuntimeWorkflowEvent['status'],
    message: string,
    attempt?: number,
    maxAttempts?: number,
  ): void {
    const timestamp = new Date().toISOString();
    state.updatedAt = timestamp;
    state.events.push({
      roleId,
      status,
      message,
      timestamp,
      ...(attempt === undefined ? {} : { attempt }),
      ...(maxAttempts === undefined ? {} : { maxAttempts }),
    });
  }
}
