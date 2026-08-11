# Contributing

Contributions are welcome through issues and pull requests. By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before opening a change

- Use the [bug report form](https://github.com/Abubakr-Sanginov/AIDev/issues/new?template=bug_report.yml) for reproducible defects.
- Use the [feature request form](https://github.com/Abubakr-Sanginov/AIDev/issues/new?template=feature_request.yml) for focused proposals grounded in a real workflow.
- Read [SUPPORT.md](SUPPORT.md) for usage questions and [SECURITY.md](SECURITY.md) for private vulnerability reporting.
- Keep one problem per issue and one focused change per pull request. Discuss substantial architecture or safety changes in an issue before implementation.

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

Do not commit credentials, environment files, runtime state, generated output, logs, or fixtures containing real user data. Report security-sensitive findings through the private process in [SECURITY.md](SECURITY.md), not in a public issue.

## Pull request process

1. Link the issue or explain the concrete problem being solved.
2. Keep commits and generated changes scoped to that problem.
3. Complete the pull request checklist and disclose known limitations or verification exceptions.
4. Address review feedback with additional tests when behavior changes.

Submission does not guarantee acceptance or a release timeline. Maintainers may ask to reduce scope or revise an approach to preserve safety and compatibility.
