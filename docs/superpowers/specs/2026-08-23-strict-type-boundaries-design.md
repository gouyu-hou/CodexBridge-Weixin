# Strict Type Boundaries Design

## Goal

Enable strict TypeScript checking for newly extracted command and Weixin admin backend modules without enabling strict mode for the whole repository.

## Configuration

Add dedicated no-emit configurations that extend the root compiler baseline and set `allowJs: false`, `strict: true`, and `noEmit: true`.

One configuration covers the extracted command-service boundary and its directly required typed modules. A second covers the extracted Weixin admin backend services and their typed contracts. Existing React admin strict checking remains unchanged.

## Integration

Add explicit npm scripts for both strict checks and include them in `verify:release` before tests. The root `tsconfig.json` remains `strict: false`, and `packages/codex-native-api/tsconfig.json` remains unchanged in this phase.

## Migration Rules

- Fix strict errors only inside the selected boundary or its explicit type contracts.
- Do not add broad `any`, `@ts-ignore`, or non-null assertions merely to satisfy the compiler.
- Use `unknown` plus narrowing for external JSON and HTTP input.
- Do not refactor runtime behavior as part of strictness fixes.

## Tests

The new typecheck commands must fail before configuration and script wiring exist, then pass after the boundary is typed. Runtime focused tests and the complete release gate must remain green.
