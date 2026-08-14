# Weixin Admin React Visual Redesign

## Summary

Replace the Weixin desktop admin browser implementation with a React 19 and
TypeScript application whose visual language follows the supplied Codex++
reference. The redesign prioritizes visual quality, consistency, and smooth
navigation while preserving every existing backend API and user-facing
operation.

The Web chat console is outside this redesign and remains unchanged.

## Goals

- Match the calm desktop-tool character of the Codex++ reference.
- Replace the current browser JavaScript modules with typed React components.
- Apply one coherent component system across every existing admin page.
- Provide separately designed light and dark themes with a persistent user
  preference.
- Make hash-route transitions feel smooth without slowing repeated operations.
- Preserve all existing API contracts, permissions, side effects, and service
  behavior.
- Keep the packaged Electron admin usable at common desktop window sizes.

## Non-goals

- No backend API changes.
- No provider, model, account, permission, update, backup, or service behavior
  changes.
- No removal or redesign of `apps/web`.
- No new language switcher or unrelated product feature.
- No migration to a client-side data framework unless the existing request
  behavior cannot be preserved with small typed hooks.

## Chosen Approach

Use React 19, TypeScript, Vite, and `lucide-react`.

React is already used by the repository's Web console, so it avoids introducing
a second component ecosystem. Vite will bundle React and all browser
dependencies into stable static assets consumed by the existing admin server.
The framework is an implementation tool; the primary deliverable is the visual
redesign.

Rejected alternatives:

- Continue with vanilla JavaScript and CSS: lowest migration cost, but does not
  provide the requested component architecture or reliable visual consistency.
- Introduce Vue: technically suitable, but creates a second frontend stack and
  duplicates repository-level tooling and conventions.
- Rewrite backend and frontend together: unnecessary risk and violates the
  UI-only scope.

## Application Boundary

Create the React source under:

```text
src/platforms/weixin/admin_app/
  main.tsx
  App.tsx
  api/
  components/
  hooks/
  layouts/
  pages/
  routes/
  styles/
  types/
```

`src/platforms/weixin/admin_page.ts` becomes a minimal HTML shell that emits:

- CSP and admin-token metadata
- favicon links
- the React root element
- the built `admin.css` and nonce-authorized `admin.js`

Vite writes deterministic assets to:

```text
assets/weixin-admin/admin.css
assets/weixin-admin/admin.js
```

The existing asset URLs and packaging boundary remain stable. No CDN or runtime
network dependency is allowed.

## Navigation And Routing

Keep the existing hash identifiers so bookmarks and current admin behavior stay
compatible:

- `#overview`
- `#users`
- `#runtime`
- `#diagnostics`
- `#metrics`
- `#settings`
- `#updates`
- `#provider`
- `#phone-guide`
- `#sessions`
- `#logs`
- `#backup`

The sidebar visually groups the routes without changing their destinations:

```text
Workspace
  Overview
  Weixin Accounts
  Sessions

Configuration
  Providers and Models
  Runtime Settings
  Usage Metrics

Maintenance
  Runtime Status
  Diagnostics and Logs
  Updates and Backup
  Phone Guide
```

On desktop the sidebar is fixed. At narrow window widths it collapses into a
drawer while preserving the same route list and keyboard order.

## Visual Direction

The visual direction follows the supplied Codex++ reference rather than a
generic blue enterprise dashboard.

### Layout

- Fixed light-gray sidebar, approximately 248 px wide.
- Page header approximately 88 px high with page title, subtitle, theme control,
  refresh, and the relevant service command.
- Main workspace uses a slightly darker light-gray background and 24 px page
  padding.
- White tool panels are full-width content blocks with 8 px radius, a subtle
  border, and a restrained shadow.
- Repeated content such as accounts, providers, sessions, and history uses
  tables or lists rather than decorative cards.
- No gradients, decorative blobs, oversized marketing content, or nested cards.

### Light Theme Tokens

```text
workspace       #edf0f4
sidebar         #e9edf2
header          #f7f8fa
panel           #ffffff
panel subtle    #fafbfc
border          #d7dde5
text primary    #181c24
text secondary  #687386
text muted      #8b95a5
brand/primary   #209b63
primary hover   #168b58
```

### Dark Theme Tokens

```text
workspace       #111318
sidebar         #181b21
header          #191c22
panel           #20242b
panel subtle    #1b1f25
border          #343943
text primary    #f2f4f7
text secondary  #b2bac6
text muted      #8f98a7
brand/primary   #35b77b
primary hover   #43c98a
```

Dark mode is not a color inversion. It preserves panel hierarchy, border
contrast, badges, focus states, and readable table alternation independently.

### Typography

- Use the system UI stack with `Microsoft YaHei` fallback for Chinese text.
- Page title: 24 px, 650-700 weight.
- Page subtitle: 12-13 px, secondary color.
- Tool-panel heading: 14-15 px, 700 weight.
- Navigation: 13-14 px, 600-650 weight.
- Table cells and form labels: 13-14 px.
- Captions and helper text: 11-12 px.
- Letter spacing remains zero except compact uppercase group labels.

## Core Components

Build reusable typed components for:

- `AdminShell`, `Sidebar`, `PageHeader`, and `PageTransition`
- `Button`, `IconButton`, `ThemeToggle`, and `SupportButton`
- `Panel`, `PanelHeader`, and `SectionDivider`
- `StatusBadge`, `InlineAlert`, `Toast`, and `ProgressBar`
- `DataTable`, `EmptyState`, `Skeleton`, and pagination controls
- `TextField`, `SelectField`, `Checkbox`, `Switch`, and field help
- `Dialog`, `ConfirmDialog`, and destructive-action confirmation
- account, provider, session, diagnostic, update, log, and backup views

Use Lucide icons inside controls. Tooltips identify icon-only controls. The
support entry is a small secondary button at the bottom of the sidebar; it must
not use a bright card, gradient, or prominent top-bar placement.

## Page Composition

### Overview

- A Codex++-style service summary panel with aligned status rows.
- Primary actions for refresh and diagnostics, with restart kept in the header.
- A compact progress/status region for message handling.
- A persistent inline alert only when attention is required.
- A normal table for connected accounts.

### Accounts And Pairing

- Account table as the primary surface.
- Pairing opens in a focused dialog or side panel rather than competing with the
  table.
- Role, model, and permission editing use consistent field groups.

### Providers And Models

- Provider list and current status in a table.
- Provider editing in a focused form panel.
- Model selection remains constrained to the existing validated model catalog.
- Usage state uses progress and status rows instead of decorative charts.

### Runtime, Diagnostics, Metrics, And Logs

- Runtime facts use aligned description rows.
- Diagnostic results use status badges and expandable details.
- Metrics retain useful charts but remove decorative or redundant visuals.
- Logs use a stable monospace viewer with filters and bounded layout.

### Settings, Updates, And Backup

- Forms use clear section headings, consistent labels, and sticky save actions
  only when needed.
- Update progress and history remain in one visual hierarchy.
- Destructive restore and shutdown actions stay visually separated and require
  confirmation.

### Sessions And Phone Guide

- Session management uses a dense, scannable table and focused actions.
- The phone guide retains its content but adopts the same typography and panel
  rules; it does not become a marketing page.

## Motion

Route changes use the View Transitions API when available, with a CSS fallback:

- Duration: 180 ms.
- Enter: opacity 0 to 1 and translateY(4px) to 0.
- Exit: short opacity fade only.
- Sidebar active state changes immediately so navigation never feels delayed.
- Rapid navigation commits only the latest route and does not queue animation.
- Loading content does not resize the application shell.
- `prefers-reduced-motion: reduce` disables route and decorative motion.

Buttons, table rows, and menus use short 100-140 ms state transitions. No spring
animation, bounce, scale-heavy hover, or parallax is allowed.

## Theme Behavior

- First visit follows `prefers-color-scheme`.
- A top-bar icon button toggles light and dark themes.
- Explicit user selection is persisted in local storage.
- The explicit selection takes precedence over later system changes.
- If the stored value is invalid, fall back to the system preference.
- Theme selection must apply before the first painted React frame to avoid a
  light/dark flash.

## Data Flow And Behavior Preservation

Typed API modules wrap the existing endpoints without changing request or
response contracts. Shared service status and theme state live near the app
shell. Page-specific state remains within page hooks so one page cannot reset
another page's operation accidentally.

Existing polling, refresh, save, retry, pairing, restart, update, backup,
shutdown, and confirmation behavior must be preserved. Requests in progress
are reflected only in the relevant button or panel; the whole interface should
not become blocked unless the operation is globally exclusive.

## Loading And Error States

- Initial page fetch: stable skeleton matching the final table or form shape.
- Local refresh: retain existing content and show a bounded busy indicator.
- Successful command: short non-blocking toast.
- Recoverable request failure: inline alert within the affected panel and retry
  action.
- Global service failure: persistent banner below the page header.
- Field validation: inline message next to the field.
- Destructive command: typed confirmation dialog with explicit target name.
- Unknown render error: app-level error boundary with reload and diagnostics
  actions.

No error state may expose credentials, raw secrets, or unbounded stderr.

## Accessibility And Responsive Behavior

- All controls are reachable by keyboard and have visible focus rings.
- Icon-only controls have accessible names and hover tooltips.
- Color is never the only status indicator.
- Text and controls meet WCAG AA contrast in both themes.
- Tables scroll horizontally below their minimum content width.
- At narrow widths the sidebar becomes a drawer and header actions collapse into
  an action menu.
- Dialogs trap focus and restore it to the invoking control on close.

## Testing Strategy

### Unit And Component Tests

- Route parsing and fallback behavior.
- Theme initialization, persistence, and invalid-value recovery.
- API request/response mapping against existing endpoint fixtures.
- Loading, success, empty, warning, and failure states for shared components.
- Destructive confirmation and busy-state protection.
- Page-level interaction tests for every existing command surface.

Use Vitest, React Testing Library, and a DOM test environment. Fetch behavior is
injected or stubbed at the API boundary rather than mocked inside components.

### Build And Integration Tests

- React TypeScript typecheck and deterministic Vite build.
- Existing admin asset boundary and CSP tests updated for the React shell.
- Existing packaged Electron CDP smoke retained and expanded to wait for the
  React-ready marker.
- Smoke interactions cover navigation, theme switching, refresh, provider model
  selection, account controls, sessions, logs, settings, and setup.
- No browser console error or unhandled rejection is allowed.

### Visual Verification

Capture and inspect screenshots for both themes at minimum:

- 1920 x 1080
- 1440 x 900
- 1280 x 720
- 1024 x 768

Verify no overlap, clipped text, unstable dimensions, blank panels, broken
icons, or unreadable dark-theme surfaces. Compare the shell, spacing, cards,
tables, forms, dialogs, and transition end states against the approved Codex++
direction.

## Migration Sequence

1. Add the React/Vite build boundary and minimal shell behind tests.
2. Implement design tokens, shell, theme, routing, and shared components.
3. Migrate pages in focused batches while preserving endpoint behavior.
4. Migrate setup and support dialogs.
5. Remove the old browser JavaScript modules only after parity tests pass.
6. Expand packaged browser smoke and screenshot verification.
7. Run the complete release verification gate and packaged smoke.

At every migration step the generated assets remain buildable. No temporary
mixed implementation is considered complete until every existing admin action
is represented in React.

## Acceptance Criteria

- Every current Weixin admin page and operation is available in React.
- The light theme visibly matches the approved Codex++ direction.
- The dark theme has equivalent hierarchy and readable contrast.
- Theme selection persists without a flash on reload.
- Route transitions are smooth, bounded, and disabled for reduced motion.
- The support button remains visually secondary.
- Existing backend API and Electron behavior are unchanged.
- The Web chat console is unchanged.
- All component, integration, package, and release verification checks pass.
- Multi-size light/dark screenshots show no overlap, clipping, blank output, or
  broken interaction states.
