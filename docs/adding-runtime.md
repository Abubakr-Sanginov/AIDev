# Adding a runtime

Implement the `CodingRuntime` interface from `src/runtimes/runtime.ts`. A runtime adapter must use an official CLI, API, or protocol and must not emulate a branded coding agent.

1. Give the runtime a stable lowercase ID and display name.
2. Detect the executable and version without modifying the system.
3. Return platform-specific official installation instructions.
4. Require explicit user approval before installation.
5. Delegate authentication to the runtime; never read or store credentials.
6. Launch interactive mode through `TerminalLauncher` when visibility is requested.
7. Use the runtime's official structured non-interactive interface for orchestration.
8. Represent each role invocation with a `RuntimeSession`.
9. Implement cancellation and status honestly; document unsupported capabilities rather than faking them.
10. Register the adapter in a `RuntimeRegistry` and add tests using injected process and terminal boundaries where practical.

Adapters must constrain the working directory to the selected project and bound process time and output. Ordinary tests must not require installed runtimes or paid model access.
