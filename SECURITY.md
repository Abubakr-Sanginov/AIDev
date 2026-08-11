# Security Policy

## Supported versions

AI Development Team does not currently publish supported release branches. Security fixes are developed against the latest code on `main`. Older commits and local modifications are not supported.

## Reporting a vulnerability

Do not open a public issue or discussion for a suspected vulnerability.

Use GitHub's private vulnerability reporting for this repository by selecting **Report a vulnerability** on the [Security advisories page](https://github.com/Abubakr-Sanginov/AIDev/security/advisories/new). Include:

- the affected commit or version;
- a concise impact assessment;
- minimal reproduction steps or a proof of concept;
- relevant configuration with all credentials and private project data removed; and
- any suggested mitigation, if known.

If private vulnerability reporting is unavailable, do not disclose exploit details publicly. Use GitHub's private support channels to notify the repository owner that a private reporting channel is needed.

You should receive an acknowledgement through GitHub within 7 days. Triage and remediation timing depends on severity, reproducibility, and maintainer availability; no release date is promised. The report will remain private while it is assessed and while a reasonable fix and disclosure plan are prepared. Coordinated disclosure and credit are welcome, but attribution is optional.

## Scope and safe research

High-value reports include path-confinement bypasses, command-policy or approval bypasses, credential exposure, unsafe runtime process handling, and malicious persisted-state behavior. Reports about third-party coding-agent services or CLIs should also be sent to their respective maintainers when the defect is outside this project's code.

Test only with data and systems you own or are authorized to use. Do not access other users' data, degrade services, or include live secrets in a report.
