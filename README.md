# Hugents

Hugents is a free, local-first multi-project QA agent system for web applications. It is designed to run tests through browser automation, store sanitized execution events and tasks, and provide a small interactive agent office interface. Status: early design, nothing runnable yet.

## Principles

- Free to run.
- Local-first execution.
- Truthful by design: the UI never shows activity that did not happen.
- Sanitized by default.
- Project-agnostic through manifests, never hardcoded target projects.
- Human approval before writing to any third-party system.

## Architecture overview

```text
Project Manifest
    |
    v
Scenario Generator ---> Core Orchestrator ---> Worker (Playwright)
                               |                     |
                               v                     v
                              API <----------- Sanitized Events
                               |
                               v
                        Agent Office UI
```

All events are sanitized before leaving the worker boundary.

## Planned stack

- TypeScript on Node.
- Playwright for browser automation.
- Firebase (dedicated Hugents project) for persistence, authentication, and real-time data.
- Optional scheduled worker in GitHub Actions, plus a local worker on the owner's computer.
- Optional Gemini API provider with deterministic fallback when unavailable.
- Static UI hosted on the owner's portfolio.

## Repository layout

- `docs/`: architecture, security model, manifest format, roadmap, and design decisions.
- `packages/core/`: planned orchestration contracts and execution model.
- `packages/adapters/`: planned project adapters from manifest to runtime behavior.
- `packages/scenarios/`: planned reusable QA scenarios.
- `packages/generator/`: planned scenario/test proposal generator.
- `packages/runtime/`: configurable agent runtime: versioned agent packages, artifact registry, boards with human approval gates ([docs/agent-runtime.md](docs/agent-runtime.md)).
- `packages/api/`: planned backend API surface.
- `packages/ui/`: planned agent office interface.
- `packages/cli/`: planned command-line entry points.
- `examples/`: placeholder location for safe sample manifests.

## Roadmap phases

0. Repository scaffold and security policy.
1. Extract the event contract, sanitizer, provider interface and a `Store` interface from the existing prototype.
2. Project manifest format and the first adapter.
3. Local core with Firestore emulator.
4. Local Playwright worker.
5. API, admin login and a public read-only view.
6. Agent office UI.
7. GitHub Actions worker with a leak-detection test.
8. Test generator that proposes tests for human approval.

## Security summary

This repository is public and must keep all sensitive data out of commits, logs, artifacts, and discussions. See `SECURITY.md` for the full policy.

## Public repository note

This repository must never contain secrets, real target URLs, test account data, or captured artifacts.

## License

MIT. See [LICENSE](LICENSE).
