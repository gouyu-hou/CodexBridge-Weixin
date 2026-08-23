# Complete Optimization Roadmap Design

## Goal

Complete the five agreed optimization areas without changing user-visible command behavior, admin API contracts, provider protocol behavior, or release metadata.

## Delivery Strategy

Use one isolated feature branch with five sequential, independently reviewable phases. Each phase has its own design and implementation plan, follows TDD, ends in a focused verification gate, and is committed before the next phase starts.

The phases execute in this order:

1. Complete assistant-record command orchestration extraction.
2. Split the Weixin admin backend into focused services.
3. Add strict type boundaries for the newly extracted services.
4. Share the next AppClient state-machine layer.
5. Upgrade the three approved low-risk dependencies one at a time.

## Global Compatibility Contract

- Preserve `/as`, `/log`, `/todo`, `/remind`, and `/note` aliases, text, metadata, persistence ordering, and confirmation semantics.
- Preserve every existing Weixin admin URL, HTTP method, authorization rule, status code, JSON field, and transactional rollback behavior.
- Preserve Codex app-server JSON-RPC payloads, event ordering, approval decisions, timeout behavior, and terminal output selection.
- Keep root `strict: false`; strictness expands only through dedicated opt-in configurations.
- Upgrade only Electron `41.10.5 -> 41.10.6`, `@testing-library/user-event 14.6.4 -> 14.6.6`, and `@openai/codex 0.144.6 -> 0.149.0`.
- Do not upgrade Electron 43, TypeScript 7, Vite 8, or `@openai/agents`.
- Do not bump the application version, create a tag, or create a GitHub Release.
- Do not force-push.

## Quality Gates

Every phase must provide a red-green TDD record, focused tests, relevant type checks, `git diff --check`, and an independent review. The final branch must pass `npm run verify:release`; the Electron dependency phase must also build the Windows distribution package.

## Rollback Model

Each phase and each dependency upgrade is committed separately. A failed or incompatible phase can therefore be reverted without discarding the successful earlier phases.

## Child Designs

- `2026-08-23-assistant-record-command-service-phase-two-design.md`
- `2026-08-23-weixin-admin-server-services-design.md`
- `2026-08-23-strict-type-boundaries-design.md`
- `2026-08-23-codex-app-client-state-sharing-design.md`
- `2026-08-23-low-risk-dependency-upgrades-design.md`
