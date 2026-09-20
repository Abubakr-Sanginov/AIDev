import { readdir } from 'node:fs/promises';
import { isFatalDiagnostic, isProviderDiagnostic } from './failure-policy.js';
import { getRole, isReadOnlyRole, roles } from '../roles.js';
import { formatProjectContext, inspectProject } from '../project-context.js';
import { formatSkillsForPrompt, writeSkillsToProject } from '../skills.js';
export function workflowProgress(state) {
    return { completed: state.completedPhases ?? 0, total: state.totalPhases ?? 5 };
}
const FULL_STACK_SIGNAL = /full-?stack|фулл?-?стек|полный\s+стек/i;
const BACKEND_SIGNAL = /\bapi\b|backend|server|database|persistence|graphql|endpoint|rest-?ful|\bservice\b|\bbot\b|бэкенд|бекенд|сервер|база\s+данных|микросервис/i;
const FRONTEND_SIGNAL = /frontend|storefront|dashboard|user ?interface|\bui\b|client-?side|\bweb\b|website|web-?site|landing|portfolio|pages?\b|blog|e-?commerce|портфолио|сайт|лендинг|страниц|интерфейс|магазин|блог|витрин|фронтенд/i;
const IMPLEMENTATION_DIRECTIVE = '\n\nYou MUST create or modify the project files in the target project directory using your file-writing tools. A text-only response without created files counts as a failed attempt.';
const FAIL_VERDICT = /VERDICT:\s*FAIL\b/i;
const PASS_VERDICT = /VERDICT:\s*PASS\b/i;
const DEFECT_FINDING = /\b(?:defects?|failures?|errors?|issues?)\s*:\s*(?!none\b|no\b|0\b)/i;
const NO_DEFECT_FINDING = /\b(?:no\s+(?:reproducible\s+)?defects?|defects?\s*:\s*(?:none|no|0))\b/i;
export class RuntimeOrchestrator {
    #root;
    #runtime;
    #maxFixAttempts;
    #visibleRuntime;
    #heartbeatMs;
    #modelCandidates;
    #modelIndex = 0;
    #maxAgentAttempts;
    #retryBackoffMs;
    #onState;
    #onStateError;
    #statePublication = Promise.resolve();
    #scheduledRoles = [];
    #fatalDiagnostic;
    constructor(options) {
        this.#root = options.root;
        this.#runtime = options.runtime;
        this.#maxFixAttempts = options.maxFixAttempts ?? 2;
        this.#visibleRuntime = options.visibleRuntime ?? false;
        // The heartbeat only refreshes the live dashboard (elapsed time, spinner)
        // between real activity events, so it ticks fast: the CLI keeps disk writes
        // throttled separately.
        this.#heartbeatMs = options.heartbeatMs ?? 200;
        // An explicitly pinned model wins; otherwise Auto rotates the candidate list.
        this.#modelCandidates =
            options.model !== undefined ? [options.model] : [...(options.models ?? [])];
        this.#maxAgentAttempts = Math.max(1, options.maxAgentAttempts ?? 3);
        this.#retryBackoffMs = Math.max(0, options.retryBackoffMs ?? 100);
        this.#onState = options.onState ?? (() => undefined);
        this.#onStateError = options.onStateError ?? (() => undefined);
    }
    get #activeModel() {
        return this.#modelCandidates[this.#modelIndex];
    }
    /** Advances to the next Auto candidate; undefined when the list is exhausted. */
    #advanceModel() {
        if (this.#modelIndex >= this.#modelCandidates.length - 1)
            return undefined;
        this.#modelIndex += 1;
        return this.#activeModel;
    }
    async run(goal) {
        const projectContext = await inspectProject(this.#root);
        const projectSummary = formatProjectContext(projectContext);
        const now = new Date().toISOString();
        const implementationRoles = this.#implementationRoles(goal, projectContext);
        const skippedLayers = ['backend', 'frontend'].filter((roleId) => !implementationRoles.includes(roleId));
        this.#scheduledRoles = ['manager', 'architect', ...implementationRoles, 'tester', 'reviewer'];
        const state = {
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
            ...(this.#activeModel === undefined ? {} : { model: this.#activeModel }),
            projectContext,
        };
        const artifacts = {};
        for (const roleId of skippedLayers) {
            artifacts[roleId] =
                `[SKIPPED ${roleId}] No matching project structure or manifest signal was detected.`;
            this.#event(state, roleId, 'SKIPPED', 'No matching project structure or manifest signal was detected.');
        }
        const initialProjectArtifacts = await this.#projectArtifacts();
        const verifyArtifacts = initialProjectArtifacts === 0
            ? async () => (await this.#projectArtifacts()) === 0
                ? `No project artifacts exist in target directory ${this.#root}; the implementation role cannot be considered complete.`
                : undefined
            : undefined;
        // Publish the bundled skills into the project so every role (and the user)
        // can consult them; prompt injection below is the primary channel.
        await writeSkillsToProject(this.#root);
        artifacts.manager = await this.#safeExecute('manager', `Target project directory: ${this.#root}\nexistingProject: ${projectContext.existingProject}\n${projectSummary}\n\nCustomer request:\n${goal}`, state, 'Manager failed; continue from the customer request.');
        artifacts.architect = await this.#safeExecute('architect', this.#artifactHandoff(goal, artifacts, projectSummary), state, 'Architecture unavailable; continue conservatively and report the gap.');
        for (const roleId of implementationRoles)
            artifacts[roleId] = await this.#safeExecute(roleId, this.#artifactHandoff(goal, artifacts, projectSummary) + IMPLEMENTATION_DIRECTIVE, state, `${roleId} failed; continue independent work and report the gap.`, verifyArtifacts);
        let missingArtifacts = initialProjectArtifacts === 0 && (await this.#projectArtifacts()) === 0;
        if (missingArtifacts) {
            artifacts.artifactVerification =
                `VERDICT: FAIL - no project artifacts exist in target directory ${this.#root}. ` +
                    'The implementation role cannot be considered complete.';
            await this.#publish(state);
        }
        artifacts.tester = await this.#safeExecute('tester', this.#artifactHandoff(goal, artifacts, projectSummary), state, 'Testing unavailable; Reviewer must report the verification gap.');
        if (missingArtifacts)
            artifacts.tester = `${artifacts.tester}\n${artifacts.artifactVerification}`;
        if (this.#reportsDefects(artifacts.tester)) {
            for (let attempt = 0; attempt < this.#maxFixAttempts; attempt += 1) {
                artifacts.fixer = await this.#safeExecute('fixer', this.#artifactHandoff(goal, artifacts, projectSummary) + IMPLEMENTATION_DIRECTIVE, state, 'Fix failed; preserve defect for review.');
                // Cycles where the fixer never actually ran (e.g. skipped after a
                // fatal runtime failure) must not count as fix attempts.
                if (!artifacts.fixer.startsWith('[UNAVAILABLE '))
                    state.attempts += 1;
                missingArtifacts = initialProjectArtifacts === 0 && (await this.#projectArtifacts()) === 0;
                if (missingArtifacts) {
                    artifacts.artifactVerification = `VERDICT: FAIL - no project artifacts exist in target directory ${this.#root}.`;
                }
                else {
                    delete artifacts.artifactVerification;
                }
                artifacts.tester = await this.#safeExecute('tester', this.#artifactHandoff(goal, artifacts, projectSummary), state, 'Retest unavailable; preserve verification gap.');
                if (missingArtifacts)
                    artifacts.tester += `\n${artifacts.artifactVerification}`;
                if (!this.#reportsDefects(artifacts.tester))
                    break;
            }
        }
        let review = '[SKIPPED reviewer] Verification prerequisites did not pass.';
        if (!this.#reportsDefects(artifacts.tester) && !artifacts.tester.startsWith('[UNAVAILABLE ')) {
            review = await this.#safeExecute('reviewer', this.#artifactHandoff(goal, artifacts, projectSummary), state, 'Review unavailable; workflow ended with diagnostic evidence.');
        }
        else {
            this.#event(state, 'reviewer', 'SKIPPED', 'Reviewer not scheduled because implementation verification did not pass.');
        }
        state.status =
            !this.#reportsDefects(artifacts.tester) && this.#reviewApproved(review) ? 'DONE' : 'FAILED';
        delete state.currentRoleId;
        await this.#terminalize(state);
        await this.#publish(state);
        return state;
    }
    #implementationRoles(goal, projectContext) {
        const fullStack = FULL_STACK_SIGNAL.test(goal);
        const backend = fullStack || BACKEND_SIGNAL.test(goal) || projectContext.layers.backend;
        const frontend = fullStack || FRONTEND_SIGNAL.test(goal) || projectContext.layers.frontend;
        if (backend && frontend)
            return ['backend', 'frontend'];
        if (backend)
            return ['backend'];
        if (frontend)
            return ['frontend'];
        return ['coder'];
    }
    #reportsDefects(output) {
        if (FAIL_VERDICT.test(output))
            return true;
        if (PASS_VERDICT.test(output) || NO_DEFECT_FINDING.test(output))
            return false;
        return DEFECT_FINDING.test(output);
    }
    #reviewApproved(output) {
        return (!output.startsWith('[UNAVAILABLE ') &&
            !/\bCHANGES_REQUIRED\b/i.test(output) &&
            /\bAPPROVED\b|VERDICT:\s*PASS\b/i.test(output));
    }
    async #safeExecute(roleId, prompt, state, fallback, verify) {
        if (this.#fatalDiagnostic !== undefined) {
            this.#event(state, roleId, 'SKIPPED', `Skipped: a fatal runtime failure already ended the workflow (${this.#fatalDiagnostic}).`);
            await this.#publish(state);
            return `[UNAVAILABLE ${roleId}] ${this.#fatalDiagnostic}.`;
        }
        let diagnostic = 'Unknown runtime failure';
        let attempt = 1;
        while (attempt <= this.#maxAgentAttempts) {
            try {
                const diagnosticContext = attempt === 1
                    ? ''
                    : `\n\nRetry diagnostic: attempt ${attempt}/${this.#maxAgentAttempts}. Previous failure: ${diagnostic}. Resume the same ${roleId} stage; do not skip prerequisites.`;
                return (await this.#execute(roleId, prompt + diagnosticContext, state, attempt, verify))
                    .output;
            }
            catch (error) {
                diagnostic = error instanceof Error ? error.message : String(error);
                if (isFatalDiagnostic(diagnostic)) {
                    // Billing/quota/auth failures kill the current model, not the stage:
                    // rotate to the next Auto candidate before giving up.
                    const previous = this.#activeModel;
                    const next = this.#advanceModel();
                    if (next !== undefined) {
                        state.model = next;
                        this.#event(state, roleId, 'RETRYING', `Fatal failure${previous === undefined ? '' : ` on ${previous}`}: ${diagnostic.slice(0, 220)} Switching to ${next}.`, attempt, this.#maxAgentAttempts);
                        await this.#publish(state);
                        continue; // provider switches do not consume agent attempts
                    }
                    // Retrying cannot fix billing, quota, or authentication problems
                    // and no alternative model remains: fail fast with the actionable
                    // provider message instead of burning retries.
                    this.#fatalDiagnostic = diagnostic;
                    this.#event(state, roleId, 'FAILED', `Fatal runtime failure, retries skipped: ${diagnostic}. Fix the provider account/model and rerun.`, attempt, this.#maxAgentAttempts);
                    await this.#publish(state);
                    return `[UNAVAILABLE ${roleId}] ${diagnostic}.`;
                }
                if (attempt === this.#maxAgentAttempts)
                    break;
                const delay = this.#retryBackoffMs * 2 ** (attempt - 1);
                state.status = 'RUNNING';
                state.currentRoleId = roleId;
                this.#event(state, roleId, 'RETRYING', `Attempt ${attempt}/${this.#maxAgentAttempts} failed: ${diagnostic}. Retrying same stage in ${delay}ms.`, attempt, this.#maxAgentAttempts);
                await this.#publish(state);
                if (delay > 0)
                    await new Promise((resolve) => setTimeout(resolve, delay));
                attempt += 1;
            }
        }
        // Provider-side causes (rate limits, 5xx, timeouts, network failures) are
        // reported as FAILED because only the provider can fix them. Our own
        // failures (budgets, verification mismatches, denied approvals) must not
        // mark the role failed: the workflow continues with a recovery event and
        // the downstream roles see an honest [UNAVAILABLE] artifact.
        const providerSide = isProviderDiagnostic(diagnostic);
        this.#event(state, roleId, providerSide ? 'FAILED' : 'SKIPPED', providerSide
            ? `Provider failure after ${this.#maxAgentAttempts} attempts: ${diagnostic}. ${fallback}`
            : `Recovery policy: internal failure after ${this.#maxAgentAttempts} attempts (not provider-side, role not marked failed): ${diagnostic}. ${fallback}`, this.#maxAgentAttempts, this.#maxAgentAttempts);
        await this.#publish(state);
        return `[UNAVAILABLE ${roleId}] ${diagnostic}. ${fallback}`;
    }
    #artifactHandoff(goal, artifacts, projectSummary) {
        const sections = Object.entries(artifacts).map((entry) => `## ${entry[0]}\n${entry[1].slice(0, 6000)}`);
        return `Target project directory: ${this.#root}\nAll filesystem and command operations MUST use this directory as the working directory.\n${projectSummary}\nGoal: ${goal}\nConcise upstream artifacts:\n${sections.join('\n')}`;
    }
    async #projectArtifacts() {
        try {
            const entries = await readdir(this.#root, { withFileTypes: true });
            return entries.filter((entry) => !['.ai-dev-team', '.ai-team', '.git'].includes(entry.name))
                .length;
        }
        catch {
            return 0;
        }
    }
    async #terminalize(state) {
        for (const session of state.sessions) {
            if (session.status === 'running' ||
                session.status === 'starting' ||
                session.status === 'paused') {
                try {
                    await this.#runtime.stop(session);
                }
                catch {
                    session.status = 'stopped';
                }
            }
        }
        const latest = new Map();
        for (const event of state.events)
            latest.set(event.roleId, event);
        for (const role of roles) {
            const event = latest.get(role.id);
            if (!event) {
                this.#event(state, role.id, 'SKIPPED', 'Agent was not scheduled for this workflow.');
            }
            else if (event.status === 'RUNNING' ||
                event.status === 'ACTIVE' ||
                event.status === 'RETRYING') {
                this.#event(state, role.id, 'CANCELLED', 'Outstanding agent cancelled at workflow end.');
            }
        }
    }
    async #execute(roleId, context, state, attempt = 1, verify) {
        const role = getRole(roleId);
        const session = await this.#runtime.launch({
            workingDirectory: this.#root,
            roleId,
            visible: this.#visibleRuntime,
        });
        state.sessions.push(session);
        state.currentRoleId = roleId;
        this.#event(state, roleId, 'RUNNING', `${role.name} attempt ${attempt}/${this.#maxAgentAttempts} started.`, attempt, this.#maxAgentAttempts);
        if (session.terminalOpened)
            this.#event(state, roleId, 'ACTIVE', `Runtime terminal opened for ${role.name}.`);
        if (session.terminalError)
            this.#event(state, roleId, 'ACTIVE', `Warning: runtime terminal could not be opened: ${session.terminalError}`);
        await this.#publish(state);
        const heartbeat = setInterval(() => {
            state.updatedAt = new Date().toISOString();
            void this.#publish(state);
        }, this.#heartbeatMs);
        let acceptingActivity = true;
        try {
            const skillsBlock = await formatSkillsForPrompt(roleId);
            const activeModel = this.#activeModel;
            const result = await this.#runtime.execute(session, {
                prompt: `${role.systemPrompt}\n\n${skillsBlock}Execution budget: ${role.budget.maxSteps} steps and ${role.budget.maxToolCalls} tool calls.\n${context}`,
                maxSteps: role.budget.maxSteps,
                maxToolCalls: role.budget.maxToolCalls,
                toolPolicy: isReadOnlyRole(roleId) ? 'read-only' : 'coding',
                ...(activeModel === undefined ? {} : { model: activeModel }),
                onActivity: async (activity) => {
                    if (!acceptingActivity || state.status !== 'RUNNING')
                        return;
                    this.#event(state, roleId, 'ACTIVE', activity.message);
                    await this.#publish(state);
                },
            });
            acceptingActivity = false;
            clearInterval(heartbeat);
            if (!result.success)
                throw new Error(result.output.trim() || `Runtime exited with code ${result.exitCode ?? 'unknown'}.`);
            if (verify !== undefined) {
                const problem = await verify();
                if (problem !== undefined) {
                    const reply = result.output.trim().replaceAll(/\s+/gu, ' ');
                    throw new Error(reply === '' ? problem : `${problem} Agent reply: ${reply.slice(0, 400)}`);
                }
            }
            this.#event(state, roleId, 'DONE', result.output);
            state.completedPhases = new Set(state.events
                .filter((event) => event.status === 'DONE' && this.#scheduledRoles.includes(event.roleId))
                .map((event) => event.roleId)).size;
            await this.#publish(state);
            return result;
        }
        catch (error) {
            acceptingActivity = false;
            clearInterval(heartbeat);
            try {
                await this.#runtime.stop(session);
            }
            catch {
                // Preserve the execution error; stop is best-effort cleanup.
            }
            session.status = 'failed';
            throw error;
        }
    }
    async #publish(state) {
        const snapshot = structuredClone(state);
        const publication = this.#statePublication.then(async () => {
            try {
                await this.#onState(snapshot);
            }
            catch (error) {
                try {
                    await this.#onStateError(error);
                }
                catch {
                    // Reporting must not crash execution.
                }
            }
        });
        this.#statePublication = publication;
        await publication;
    }
    #event(state, roleId, status, message, attempt, maxAttempts) {
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
