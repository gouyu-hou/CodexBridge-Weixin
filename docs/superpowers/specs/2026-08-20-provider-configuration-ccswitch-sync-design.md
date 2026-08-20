# Provider Configuration CCSwitch Sync Design

## Goal

Add a CCSwitch synchronization action to the Weixin admin Provider configuration panel so users can import and immediately activate their current Codex/CCSwitch provider without moving to the lower model settings panel.

## User Experience

- Place a secondary `同步 CCSwitch` button beside `保存 Provider 配置` in the Provider configuration footer.
- Use the existing shuffle icon and button styling so the action matches the current Codex++ admin design.
- Synchronization immediately replaces unsaved Provider form values, persists the CCSwitch source selection, and restarts the bridge on the imported configuration.
- Both footer actions expose independent busy states and are disabled while the other mutation is running.
- A failed synchronization keeps the current draft intact and displays the existing sanitized inline error treatment.

## Data Flow

1. The button calls `api.syncCcswitch({ persistSource: true })`.
2. The existing server endpoint reads the active Codex/CCSwitch configuration and persists it to the service environment and Provider Profile repository.
3. A successful manual synchronization clears stale session model overrides and restarts the Weixin bridge, making the imported configuration active without a separate save action.
4. The endpoint returns updated settings and admin state after the restart.
5. The component extracts `state.settings.modelProvider`, falling back to `settings.modelProvider` when needed.
6. The returned Provider becomes the new form draft, its matching preset is selected, and the selected Profile ID is propagated to the lower model editor.
7. The page requests a normal state refresh so all Provider profiles, model catalogs, and status views converge on the active configuration.

No new endpoint is introduced. Automatic interval synchronization retains its existing behavior; bridge restart is added only to the explicit admin API action.

## Component Changes

`ProviderConfiguration` owns the synchronization busy/error state and a small helper that applies a `ModelProviderSettings` value to both the selected preset and editable draft. The same helper also reconciles later `current` prop changes, ensuring external synchronization or state refreshes do not leave stale form values.

The API mutation response remains structurally typed through the existing JSON-compatible response contract. Runtime guards verify nested values before they are used as Provider settings.

## Error Handling

- API failures pass through `sanitizeAdminError` before display.
- A bridge restart failure is reported as a synchronization failure through the existing sanitized API error path.
- Missing Provider settings in an otherwise successful response fall back to the page-level state refresh.
- The draft is only replaced after a successful response contains usable Provider settings.
- API keys are never copied into the editable field; the returned configured/masked state is represented by the existing placeholder.

## Testing

React regression tests will verify:

- The new button invokes synchronization with `persistSource: true`.
- A successful response immediately selects and displays the synchronized Provider values.
- The selected Profile ID and page refresh callback are updated after synchronization.
- A rejected request displays a sanitized error and preserves the existing draft.
- The manual synchronization endpoint restarts the bridge and clears stale session model overrides after persisting imported settings.

The admin test suite, strict admin typecheck, deterministic browser asset build, and full release verification remain the completion gates.

## Out Of Scope

- Choosing a custom CCSwitch home path from this panel.
- Preview-only synchronization.
- Changes to automatic CCSwitch polling.
- Removing the existing synchronization action from the lower model settings panel.
