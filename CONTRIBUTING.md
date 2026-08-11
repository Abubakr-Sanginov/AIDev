# Contributing

Contributions are welcome through issues and pull requests.

## Development setup

1. Fork and clone the repository.
2. Use Node.js 20 or newer.
3. Install dependencies with `npm ci`.
4. Create a focused branch for the change.

## Quality checks

Run the complete local verification suite before opening a pull request:

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run format
```

Add unit or integration coverage for behavior changes. Keep terminal-facing text and README UI examples ASCII-only, preserve project-root confinement, and do not weaken command or approval safeguards to make generated commands pass.

Do not commit credentials, environment files, runtime state, generated output, logs, or fixtures containing real user data. Report security-sensitive findings privately to the maintainer instead of publishing exploit details in an issue.
