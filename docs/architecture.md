# Architecture

## Current base

`packages/duel-agent-office` is the working base: a local, deterministic QA runner (two isolated Playwright sessions), a redacting event pipeline, a read-only observer with a loopback dashboard, and an optional agent office that only writes report text. The components below are the target split; code moves into them from this package as it stabilizes.

## Components

- `core`: orchestrates runs, contracts, and execution state.
- `adapters`: map project manifests to target-specific selectors and flows.
- `scenarios`: reusable QA scenarios independent of any single project.
- `generator`: proposes test scenarios for human review.
- `api`: stores tasks and sanitized events, exposes admin and read-only views.
- `ui`: small interactive agent office interface.
- `cli`: local commands to run workers and inspect state.
- `workers`: execute Playwright actions and report sanitized outputs.

## Data flow

1. A project manifest defines allowed targets, scenarios, and restrictions.
2. Core selects or generates scenarios.
3. Worker executes scenarios through Playwright.
4. Worker emits execution events.
5. Events are sanitized at the worker boundary.
6. Sanitized events and task state are persisted through API/store components.
7. UI and CLI consume sanitized state only.

## Sanitization rule

Events are sanitized before leaving the worker. Raw page text, private identifiers, credentials, and other sensitive payloads are never exported outside the worker process.
