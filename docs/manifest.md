# Project Manifest (Planned)

Each tested project is defined by a manifest and never hardcoded.

## Planned shape

- `projectId`: stable identifier, for example `example-project`.
- `allowedTargetUrlPattern`: strict allowlist pattern for non-production targets.
- `blockedTargets`: explicit blocked targets, including production patterns.
- `testAccountVariableNames`: names of required environment variables for test accounts.
- `availableScenarios`: list of scenario ids available for this project.
- `screensToHide`: selectors or regions to mask in generated views.
- `forbiddenActions`: disallowed operations for safety and compliance.

## Rules

- Production targets are always blocked.
- Manifest values are reviewed before execution.
- Secrets are referenced by variable name only, never embedded values.
