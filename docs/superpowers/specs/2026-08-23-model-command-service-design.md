# Model Command Service Design

## Goal

Move `/models` and `/model` command orchestration out of `BridgeCoordinator` without changing model selection, reasoning-effort validation, session mutation, localization, or provider behavior.

## Chosen Boundary

Add `ModelCommandService` beside the existing pure helpers in `model_command.ts`.

The service owns:

- `/models` provider catalog loading and response rendering;
- `/model` argument normalization and routing;
- model/reset/reasoning-effort validation;
- pending-new-session and active-session settings updates;
- command-specific response construction.

`BridgeCoordinator` retains shared runtime ownership and exposes it through callbacks:

- scope and provider-profile resolution;
- pending-new-session lookup and update;
- active-turn rejection;
- bridge-session lookup and settings persistence;
- effective model-state resolution;
- localized session metadata and response construction.

The existing `model_command.ts` remains the pure parsing, selection, and rendering layer. Provider and repository objects are not imported into it.

## Data Flow

1. `BridgeCoordinator` routes `/models` or `/model` to one `ModelCommandService` instance.
2. The service resolves the scope and profile through injected callbacks.
3. For catalog-dependent actions, the service asks the provider registry callback for `listModels()` output.
4. The service applies the same pure helpers currently used by the coordinator.
5. Mutations are written through pending-session or persisted-session callbacks.
6. The service returns the existing localized response shape.

## Error And Compatibility Rules

- Preserve unsupported-provider handling.
- Preserve active-turn blocking before model mutations.
- Preserve no-session behavior, including pending `/new` sessions.
- Preserve model selection by id, display name, configured id, and one-based index.
- Preserve reset aliases and concatenated model/effort diagnostics.
- Do not alter provider errors; existing provider behavior continues to propagate unchanged.
- Do not change translations, command aliases, or response ordering.

## Testing

- Add a structural regression test proving the coordinator constructs and delegates to `ModelCommandService`.
- Keep the existing end-to-end coordinator model command tests as behavioral coverage.
- Add focused service tests only where the extracted dependency boundary needs direct proof.
- Run TypeScript checks, focused tests, full release verification, and `git diff --check` before integration.

## Non-Goals

- No new model-management features or UI changes.
- No changes to provider model catalogs or default model policy.
- No extraction of personality, fast mode, plan mode, or other settings commands.
- No refactor of model-error recovery during provider turns.
