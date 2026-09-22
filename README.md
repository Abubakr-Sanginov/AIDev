# AI Development Team

[![CI](https://github.com/Abubakr-Sanginov/AIDev/actions/workflows/ci.yml/badge.svg)](https://github.com/Abubakr-Sanginov/AIDev/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

AI Development Team is a sandboxed TypeScript CLI that coordinates user-installed AI coding agents. It assigns specialized roles to supported runtimes, persists workflow state, and verifies generated changes through a Coder-Fixer loop.

The project does not bundle a model or manage credentials for external coding-agent CLIs. Install and authenticate the runtime you intend to use.

## Features

- Runtime adapters for Claude Code, OpenCode, and Codex CLI
- Runtime detection, model discovery where supported, JSON event handling, and session continuation
- Manager, Architect, Coder, Tester, Fixer, and Reviewer workflow roles
- Deterministic mock runtime for tests, including failure, timeout, crash, and retry scenarios
- Persistent workflow state and role handoffs
- Project-root path confinement, command policy, approvals, timeouts, and bounded output
- Themed ASCII dashboard with banner, progress bar, live spinner, and end-of-run summary
- Diagnostics (`doctor`), run history (`history`), Markdown reports (`report`), persistent defaults (`config`), and state cleanup (`clean`)
- Automatic per-project run history recorded to `.ai-dev-team/history.jsonl`
- Bundled agent skills (skills.sh) wired into role prompts and published to `.ai-dev-team/skills`
- Runtime state directories are appended to the target project's `.gitignore` automatically

## What's new in 0.2.5–0.2.9

1. Bundled agent skills wired into role prompts and published into the project for inspection
2. Live dashboard redraws on the alternate screen buffer: one updating screen, no scrollback spam
3. Agent prompts travel through stdin, so long orchestrated prompts no longer hit the Windows 8191-character command-line limit
4. Localized Windows console output (CP866) is decoded correctly instead of showing mojibake
5. OpenCode JSON error events surface as readable failure messages
6. Workflow state directories are appended to the target project's `.gitignore` automatically

## What's new in 0.2.0

1. ASCII-art startup banner with per-line gradient colors
2. Boxed live dashboard with overview, agents, and activity panels
3. Unicode progress bar with percentage, elapsed time, and ETA
4. Color themes via `--theme default|ocean|forest|mono` (`NO_COLOR` is still respected)
5. Animated spinner and live elapsed timer while the workflow runs
6. `ai-dev-team doctor` environment and runtime diagnostics
7. `ai-dev-team history` — recent runs with status, duration, runtime, and goal
8. `ai-dev-team report` — Markdown export of the latest run to `.ai-dev-team/report-*.md`
9. `ai-dev-team config` — persistent per-project defaults (`runtime`, `model`, `approval`, `theme`)
10. `ai-dev-team clean` — safe removal of persisted state with confirmation
11. End-of-run summary panel with duration, fix cycles, sessions, and event counts

## Architecture

The CLI separates orchestration roles from runtime implementations. The runtime registry selects an adapter, while the orchestrator owns workflow state, handoffs, retries, and verification.

A normal run follows this sequence:

1. Manager defines the plan and acceptance criteria.
2. Architect designs the implementation.
3. Coder changes the target project.
4. Tester runs applicable verification.
5. Fixer addresses failures, and Tester reruns verification up to the configured retry limit.
6. Reviewer checks requirements, quality, and security; actionable findings enter one final Fixer-Tester cycle.

Non-implementing runtime roles use read-only policies where the selected CLI supports them. Implementing roles receive coding access subject to the project's command and approval safeguards. See [Runtime adapters](docs/runtimes.md) and [Adding a runtime](docs/adding-runtime.md).

### Live dashboard interactions

While a workflow runs, the dashboard is fully interactive. Click **Overview/Goal** to see the complete request text wrapped (never truncated), click the **Activity** panel for the entire event history with timestamps (including which tool was invoked, the command or path, and its result status), click any **agent row** to open that role's details (budget, file access, every event, sessions), and press **h** for the help overlay. Overlays scroll with the mouse wheel, ↑/↓, PgUp/PgDn, Home/End; a click inside an open view or **Esc** returns to the dashboard. The dashboard also surfaces `Idle` (time since the last event) and the previous activity line, so a stalled provider is visible at a glance. Everything runs on the alternate screen buffer, and mouse input is suspended automatically while approval prompts need the keyboard.

### Failure semantics

A role is reported as `FAILED` only when the cause is on the provider side: rate limits, HTTP 4xx/5xx responses, timeouts, offline networks, or fatal billing/quota/authentication errors. Anything the CLI itself can cause — exhausted internal budgets, missing artifacts, verification mismatches, declined approvals — is reported as a recovery event (`Recovery policy: …`) and the workflow keeps going, so a healthy provider is never blamed for our own limits. The live dashboard repaints on every event and on a fast heartbeat, while state is persisted to disk through a small throttle.

## Requirements

- Node.js 20 or newer
- npm
- Git
- At least one supported coding-agent CLI installed and authenticated for real workflows

The supported real runtimes are Claude Code, OpenCode, and Codex CLI. Runtime authentication remains in each provider's own tooling.

## Installation

Install the published CLI globally from npm:

```text
npm install -g ai-dev-team
```

Alternatively, install the latest development version directly from GitHub — the compiled `dist/` output is committed to the repository, so no build step runs during installation:

```text
npm install -g github:Abubakr-Sanginov/AIDev
```

Or install from a local clone:

```text
git clone https://github.com/Abubakr-Sanginov/AIDev.git
cd AIDev
npm ci
npm install -g .
```

Or run directly from a clone without a global installation:

```text
git clone https://github.com/Abubakr-Sanginov/AIDev.git
cd AIDev
npm ci
node dist/cli.js --help
```

On Windows, the `ai-dev-team.cmd` launcher in the repository root does the same: `ai-dev-team.cmd --help`. Add the clone directory to `PATH` to call `ai-dev-team` from any project folder.

Verify the installation:

```text
ai-dev-team --help
```

Update a global installation:

```text
npm update -g ai-dev-team
```

Remove a global installation:

```text
npm uninstall -g ai-dev-team
```

Global installs expose the compiled `dist/` output and do not include the `src/` directory. As with other installed JavaScript packages, the package contents remain accessible to the user; excluding `src/` is a packaging choice, not source-code protection or encryption.

After installation, run `ai-dev-team` from the project you want the agents to modify, or pass its path with `-C`.

## Publishing

Releases are published to the npm registry from a local checkout:

```text
git pull
npm install
npm publish
```

`npm install` keeps `package-lock.json` in sync with `package.json` and must be run (and the result committed) whenever dependency metadata changes. The `prepublishOnly` hook rebuilds `dist/` before publish. An npm account with publish rights and `npm login` are required; with 2FA enabled, pass the code via `--otp`.

## Configuration

AI Development Team has no required project `.env` file. Authenticate supported coding-agent CLIs using their official login or configuration flow. Do not place provider credentials in this repository.

Library consumers who instantiate `AnthropicProvider` directly may copy `.env.example` and supply `ANTHROPIC_API_KEY` through their own environment-loading mechanism. The CLI does not load `.env` automatically, and the example contains no real credential.

`zod` is a regular runtime dependency (the API-key provider runtimes and the tool layer need it), so a global install works out of the box. `@anthropic-ai/sdk` remains an optional peer dependency: it is required only by the library-level `AnthropicProvider`, not by the CLI. Library consumers install it explicitly: `npm install @anthropic-ai/sdk`.

Common options include:

```text
--runtime <claude|opencode|codex|mock>
--model <runtime-model-id>
--approval <ask|always|never>
--agent-attempts <count>
--fix-attempts <count>
--theme <default|ocean|forest|mono>
--no-runtime-terminal
-C <project-directory>
```

Omitting `--model` uses the runtime's automatic selection. OpenCode model IDs are discovered from its CLI. Claude Code and Codex do not expose a safe account-filtered model list through the adapter, so their interactive selector offers automatic selection rather than guessed model names.

Persistent per-project defaults can be stored with the `config` command and are applied when the matching flag is omitted:

```text
ai-dev-team config                 # show current defaults
ai-dev-team config set runtime claude
ai-dev-team config set theme ocean
ai-dev-team config reset
```

## API-key providers

In addition to locally installed coding-agent CLIs, the CLI can talk directly to hosted LLM APIs. The `providers` command family manages a per-project provider store:

```text
ai-dev-team providers                       # list configured providers (masked keys)
ai-dev-team providers list                  # same as above
ai-dev-team providers add                   # interactive: preset or custom endpoint
ai-dev-team providers add --preset openai --key sk-...
ai-dev-team providers add --custom --id mycorp --name "MyCorp LLM" --protocol openai \
  --base-url https://llm.mycorp.dev/v1 --models my-model-1,my-model-2 \
  --api-key-env MYCORP_API_KEY [--key sk-...]
ai-dev-team providers set-key mycorp        # hidden prompt, or --key for scripts
ai-dev-team providers test mycorp           # minimal request to verify the key
ai-dev-team providers remove mycorp
```

Built-in presets: `anthropic`, `openai`, `gemini`, `openrouter`, `groq`, `mistral`, `deepseek`, `xai`. Custom providers speak either the OpenAI-compatible Chat Completions protocol (`--protocol openai`, base URL includes `/v1`) or the Anthropic Messages API (`--protocol anthropic`, base URL without `/v1`).

Providers (with their model lists) are stored per user, not per project, so a provider added once is available in every project: `~/.ai-dev-team/providers.json`; keys live in `~/.ai-dev-team/secrets.json` (chmod `0600` on POSIX) or in the environment variable named by `apiKeyEnv`, which always wins over a stored key. Set `AI_DEV_TEAM_HOME` to move that directory. Both files live outside every repository and are written atomically. Projects configured with 0.3.8 or earlier are migrated automatically on first use: their `.ai-dev-team/providers.json` and `secrets.json` are merged into the global store (global entries win on conflicts) and renamed to `*.migrated.json`. Key material never appears in `providers list` output (only masked forms like `sk-…cdef`), logs, history, reports, or workflow state.

A configured provider id can be passed to `--runtime` directly, and the interactive runtime chooser also offers an "Add provider (API key)…" entry that runs the same add flow. Read-only roles (manager, tester, reviewer) run with the mutating tools (`write_file`, `edit_file`, `delete_file`, `create_directory`, `run_command`) removed, and the API adapter rejects such calls even if the model emits them. With `--approval ask` in a non-interactive (headless) shell, risky operations are declined automatically — use `--approval always` for unattended runs.

## Existing projects

Run `ai-dev-team "task"` from an existing project root to update that project in place. Before planning, the CLI performs a bounded metadata scan of the project structure, manifests, scripts, configuration, documentation, source paths, and test paths. It uses that context to preserve the project architecture and conventions while making changes.

Use `-C <path>` to select a project explicitly:

```sh
ai-dev-team -C <path> "task"
```

The scan is intentionally bounded. Secret, vendor, and generated files are excluded, and symlink directories are not traversed.

## Usage

Start an interactive run:

```text
ai-dev-team
```

Run with explicit options:

```text
ai-dev-team --runtime opencode run "Add input validation and tests"
ai-dev-team --runtime claude -C ./my-project run "Refactor the parser"
ai-dev-team --runtime codex --no-runtime-terminal run "Fix failing tests"
```

Inspect and control persisted workflows:

```text
ai-dev-team init
ai-dev-team status
ai-dev-team resume
ai-dev-team stop
ai-dev-team logs
ai-dev-team agents
ai-dev-team runtimes
```

Utility commands:

```text
ai-dev-team doctor    # diagnose Node.js, git, config, and runtimes
ai-dev-team history   # list recent runs for this project
ai-dev-team report    # export a Markdown report of the latest run
ai-dev-team config    # show or set persistent defaults
ai-dev-team clean     # remove persisted .ai-dev-team state
```

Risky commands request approval by default. `--approval never` rejects them. Use `--approval always` only in a trusted environment.

## Development

Install exact dependencies:

```text
npm ci
```

Run the source CLI during development:

```text
npm run dev -- --runtime mock run "Describe the requested change"
```

Run all quality checks:

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run format
```

The build emits ESM JavaScript to `dist/`. The compiled `dist/` output is committed to the repository so installs from GitHub work without a build step; after changing `src/`, run `npm run build` and commit the updated `dist/`.

## Project structure

```text
src/
  agents/       Shared agent loop and role prompts
  providers/    Provider abstraction and deterministic mock provider
  runtimes/     Runtime registry, process control, and CLI adapters
  terminal/     Runtime terminal launchers and log follower
  tools/        Confined file and command tools
  ui/           ASCII banner, themes, panels, and dashboard rendering
  cli.ts        Command-line entry point
  config.ts     Persistent per-project CLI defaults
  doctor.ts     Environment and runtime diagnostics
  history.ts    Append-only run history (JSONL)
  report.ts     Markdown run report export
  orchestrator.ts
                Provider-based Manager-Coder-Fixer workflow
tests/          Unit, integration, and workflow regression tests
docs/           Runtime behavior and extension guides
```

## State and environment data

Workflow state is stored in `.ai-dev-team/` by the runtime-oriented CLI and `.ai-team/` by the provider-oriented orchestrator. These directories may contain prompts, plans, reports, and local project details; when the project uses Git, the CLI appends both to the project `.gitignore` automatically.

`NO_COLOR=1` disables colored terminal output. OpenCode's adapter temporarily supplies `OPENCODE_CONFIG_CONTENT` to enforce read-only permissions for selected roles and restores the previous process value afterward.

## Security and limitations

Paths are resolved against the selected project root. Traversal outside that root is rejected. Commands execute inside the project root with timeout and output limits, known destructive patterns are blocked, and sensitive operations can require approval.

These controls reduce risk but cannot make generated code or third-party runtimes inherently trustworthy. Review every change, use a disposable branch or working copy for important projects, and never commit credentials, runtime state, logs, or real user fixtures.

Current limitations include sequential role execution, no automated Git branch management, and resume behavior that restarts the persisted goal rather than reconstructing an exact provider conversation. Runtime-specific restrictions are documented in `docs/runtimes.md`.

## Project status and roadmap

AI Development Team is an early-stage project under active, capacity-dependent maintenance. The current focus is reliability and safety rather than a fixed release schedule.

Near-term directions are:

- make persisted resume continue from safe workflow checkpoints instead of restarting the goal;
- make stop and pause affect active runtime processes rather than only persisted state;
- improve cross-platform runtime process and terminal behavior;
- expand adapter contract and security regression coverage; and
- evaluate isolated Git branch or worktree workflows without weakening approval safeguards.

These are directions, not delivery commitments. Track scoped work in [GitHub Issues](https://github.com/Abubakr-Sanginov/AIDev/issues); proposals should include verifiable acceptance criteria.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, quality checks, and security expectations.

## License

Licensed under the MIT License. See [LICENSE](LICENSE).
