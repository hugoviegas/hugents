# Security Policy

## Public repository rules

This repository is public. GitHub Actions logs and artifacts for public repositories are publicly visible, so sensitive data must never reach logs, artifacts, commits, pull requests, or issues.

## Secret handling

- Test account credentials, API keys, and tokens must exist only in repository or environment secrets, and local `.env` files.
- Secrets must never be committed to code, documentation, tests, fixtures, or examples.
- `.env` files are local only. Keep only `.env.example` in version control.

## Logging and telemetry limits

Workers must print only counts and opaque ids. Workers must never print page text, URLs, emails, tokens, room codes, session codes, or request payloads.

## Artifact and AI data handling

- Traces, videos, and raw screenshots must never be uploaded as artifacts.
- Traces, videos, and raw screenshots must never be sent to any AI provider.
- AI provider text is untrusted data and never executable instructions.
- User chat text must be converted to commands from a closed allowlist.

## Workflow hardening requirements

- Workflows must use least-privilege `permissions`.
- Workflows must not use `pull_request_target` with untrusted code.
- Workflows must not use `workflow_run` with untrusted code.
- Workflows must not run on self-hosted runners.
- Changes under `.github/workflows/` require repository owner review.

## Identity and credentials

- Prefer short-lived credentials using OIDC or workload identity.
- If long-lived keys are unavoidable, they must be scoped to the dedicated Hugents Firebase project and rotated.

## Environment separation

- Hugents must never share a Firebase project with a tested application.
- Hugents must never hold credentials for a tested project's production environment.
- Tested targets must come from a manifest allowlist.
- Production targets are always blocked.

## Reporting a vulnerability

Use GitHub Private Vulnerability Reporting in this repository's Security tab to report vulnerabilities privately.
