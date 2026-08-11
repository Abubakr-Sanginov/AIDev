# Runtime adapters

AI Development Team separates roles from coding-agent runtimes. Roles describe what work is assigned. A runtime determines which user-installed coding agent executes it.

## Read-only policy

The orchestrator marks every non-implementing role (`manager`, `tester`, `reviewer`) as `toolPolicy: 'read-only'`. Implementers (`architect`, `backend`, `frontend`, `coder`, `fixer`) run as `'coding'`. Each adapter enforces the read-only policy at its own safety boundary:

- **Codex CLI**: read-only roles launch with `--sandbox read-only` instead of `--sandbox workspace-write`.
- **Claude Code**: read-only roles append `--disallowedTools Bash, Edit, Write, MultiEdit, NotebookEdit`.
- **OpenCode**: read-only roles run with `OPENCODE_CONFIG_CONTENT={permission:{bash:"deny",edit:"deny"}}` set for the child process and restored afterwards.

The orchestrator never passes read-only requests to a live agent; when a role cannot run it records a `Recovery policy:` event, continues the remaining phases, and finishes with a resolved verdict instead of leaving the workflow permanently WAITING.

## Claude Code

Detection uses `claude --version` and `claude auth status --json`; interactive visibility uses the official `claude` entry point in a new terminal; control uses official print mode with JSON output (`claude -p ... --output-format json`); and continuation uses `--resume` when a runtime session ID is available. Claude Code has no safe CLI command that returns an account-filtered model list, so the selector offers only `Auto` instead of static model names.

## OpenCode stable

Install the official stable package with `npm install -g opencode-ai`. OpenCode must then be configured with an authentication method and model provider supported by OpenCode; complete that setup in its own TUI rather than placing credentials in AI Development Team.

Detection uses `opencode --version`. Automated role execution uses `opencode run --format json [--session SESSION_ID] MESSAGE`. The adapter consumes the NDJSON event stream, captures its session ID, joins textual result events, and uses the exact `--session` ID for a later execution in the same runtime session. Use `--runtime opencode` to select it.

```text
ai-dev-team --runtime opencode runtimes
ai-dev-team --runtime opencode launch -C ./project
ai-dev-team --runtime opencode run "Add tests"
```

`launch` opens the visible TUI as `opencode [project]`. OpenCode also supports `--continue`, but this adapter intentionally uses exact session IDs for deterministic resume. Authentication readiness cannot be established safely by version detection, so `runtimes` reports installation readiness while provider and account failures are surfaced by execution. Pause, resume, and stop currently update orchestration state; they do not suspend or terminate an already completed one-shot CLI process.

The project never stores runtime credentials. Authentication is completed in the runtime's own visible terminal. Installation uses the official npm package and requires explicit approval at the CLI layer.

## Codex CLI

Codex CLI is available as `--runtime codex`. Detection uses `codex --version`; controlled role execution uses `codex exec --json --color never --sandbox workspace-write PROMPT` (read-only roles use `--sandbox read-only`); and continuation uses `codex exec resume` with the exact thread ID captured from JSONL events.

```text
ai-dev-team --runtime codex runtimes
ai-dev-team --runtime codex -C D:\Projects\AIDevTest run "Add tests"
```

## Dashboard and runtime terminals

For each active role, real runtimes open a visible PowerShell terminal by default. It follows the output log of the exact child process controlled by the orchestrator, so it never launches a duplicate agent. The original terminal remains the dashboard and shows elapsed time, current phase, completed/total workflow phases, child-process activity, and heartbeat events. `[ RUNNING ]` never contains a fabricated percentage. Use `--no-runtime-terminal` for headless real-runtime execution. Mock runtime execution is always headless.

`MockRuntime` is deterministic and supports success, failure, timeout, and crash behavior for CI.
