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

## Requirements

- Node.js 20 or newer
- npm
- Git
- At least one supported coding-agent CLI installed and authenticated for real workflows

The supported real runtimes are Claude Code, OpenCode, and Codex CLI. Runtime authentication remains in each provider's own tooling.

## Installation

The package is not yet published to the npm registry. Install the latest version directly from GitHub (the build runs automatically through the `prepare` script):

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

Verify the installation:

```text
ai-dev-team --help
```

Update a global installation:

```text
npm install -g github:Abubakr-Sanginov/AIDev@main
```

Remove a global installation:

```text
npm uninstall -g ai-dev-team
```

Once the package is published to the npm registry, `npm install -g ai-dev-team` will work as well.

Global installs expose the compiled `dist/` output and do not include the `src/` directory. As with other installed JavaScript packages, the package contents remain accessible to the user; excluding `src/` is a packaging choice, not source-code protection or encryption.

After installation, run `ai-dev-team` from the project you want the agents to modify, or pass its path with `-C`.

## Configuration

AI Development Team has no required project `.env` file. Authenticate supported coding-agent CLIs using their official login or configuration flow. Do not place provider credentials in this repository.

Library consumers who instantiate `AnthropicProvider` directly may copy `.env.example` and supply `ANTHROPIC_API_KEY` through their own environment-loading mechanism. The CLI does not load `.env` automatically, and the example contains no real credential.

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

The build emits ESM JavaScript to `dist/`. Generated output is intentionally excluded from Git.

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
postman/        Non-secret Postman workspace globals definition
```

## State and environment data

Workflow state is stored in `.ai-dev-team/` by the runtime-oriented CLI and `.ai-team/` by the provider-oriented orchestrator. These directories may contain prompts, plans, reports, and local project details; both are ignored by Git.

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
