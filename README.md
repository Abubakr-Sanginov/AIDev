# AI Development Team

AI Development Team is a sandboxed TypeScript CLI that coordinates user-installed AI coding agents. It assigns specialized roles to supported runtimes, persists workflow state, and verifies generated changes through a Coder-Fixer loop.

The project does not bundle a model or manage credentials for external coding-agent CLIs. Install and authenticate the runtime you intend to use.

## Features

- Runtime adapters for Claude Code, OpenCode, and Codex CLI
- Runtime detection, model discovery where supported, JSON event handling, and session continuation
- Manager, Architect, Coder, Tester, Fixer, and Reviewer workflow roles
- Deterministic mock runtime for tests, including failure, timeout, crash, and retry scenarios
- Persistent workflow state and role handoffs
- Project-root path confinement, command policy, approvals, timeouts, and bounded output
- Terminal dashboard with optional visible runtime-output windows

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
- At least one supported coding-agent CLI installed and authenticated for real workflows

The supported real runtimes are Claude Code, OpenCode, and Codex CLI. Runtime authentication remains in each provider's own tooling.

## Installation

```text
git clone https://github.com/Abubakr-Sanginov/AIDev.git
cd AIDev
npm ci
npm run build
npm link
```

After linking, run `ai-dev-team` from the project you want the agents to modify, or pass its path with `-C`.

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
--no-runtime-terminal
-C <project-directory>
```

Omitting `--model` uses the runtime's automatic selection. OpenCode model IDs are discovered from its CLI. Claude Code and Codex do not expose a safe account-filtered model list through the adapter, so their interactive selector offers automatic selection rather than guessed model names.

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
  cli.ts        Command-line entry point
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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, quality checks, and security expectations.

## License

Licensed under the MIT License. See [LICENSE](LICENSE).
