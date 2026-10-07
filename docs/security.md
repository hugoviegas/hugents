# Security Model

## Public repository constraints

Hugents is a public repository. Public repository logs and artifacts are publicly visible, so no sensitive data may appear in commits, logs, artifacts, pull requests, or issues.

## Secret boundaries

- Credentials and tokens belong only in repository or environment secrets and local `.env` files.
- Secrets never belong in source files, docs, tests, fixtures, or sample manifests.

## Worker output policy

Workers output only counts and opaque ids. They never output page text, URLs, emails, tokens, room codes, session codes, or raw request payloads.

## Artifact policy

Traces, videos, and raw screenshots are never uploaded as artifacts and never sent to AI providers.

## Workflow constraints

- Use least-privilege `permissions`.
- Do not use `pull_request_target` with untrusted code.
- Do not use `workflow_run` with untrusted code.
- Do not run on self-hosted runners.
- Require owner review for workflow changes.

## Cloud credentials policy

Prefer short-lived credentials (OIDC or workload identity). Any long-lived key must be narrowly scoped to the dedicated Hugents Firebase project and rotated.

## Environment separation and target control

Hugents never shares a Firebase project with tested applications and never stores production credentials for tested projects. Target URLs come only from the manifest allowlist, and production targets are always blocked.

## AI and command safety

AI provider output is untrusted data, not instructions. User chat text is translated into commands from a closed allowlist.

## Private vulnerability reporting

Report vulnerabilities through this repository's GitHub Private Vulnerability Reporting channel.
