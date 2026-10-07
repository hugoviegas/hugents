# Roadmap

0. Repository scaffold and security policy.
1. Bring `duel-agent-office` in as the base (`packages/duel-agent-office`): deterministic Playwright runner, redaction, observer, dashboard and local agent office. It already covers the event contract and sanitizer.
2. Validate it end to end locally against a Vercel Preview and the Firebase QA accounts (`agent:private-match`, `agent:explore`), and fix selectors that drift.
3. Apply the design system and first visual design to the agent office UI.
4. First-week goal: two full matches in a row, a generated report and a short run guide.
5. Extract the shared contract, provider interface and a `Store` interface into `packages/core` once the base is stable.
6. Project manifest format and a second adapter.
7. API, admin login and a public read-only view.
8. GitHub Actions worker with a leak-detection test.
9. Test generator that proposes tests for human approval.
