# 0001: Public repository and free stack

## Context

Hugents is intended as a public, portfolio-visible project with a local-first operating model and low operating cost. It needs clear boundaries for security, reproducibility, and contribution.

## Decision

Use a public repository with documentation-first development and a free-oriented stack:

- TypeScript on Node.
- Playwright-driven worker execution.
- Dedicated Hugents Firebase project for persistence and auth.
- Optional GitHub Actions scheduled worker, plus local worker.
- Optional Gemini API provider with deterministic fallback.
- Static agent office UI hosting.

## Consequences

- Security policies must assume full public visibility of repository data, logs, and artifacts.
- Sanitization becomes a first-class requirement at worker boundaries.
- Project behavior must remain manifest-driven and project-agnostic.
- Initial delivery focuses on docs and structure before runnable code.
