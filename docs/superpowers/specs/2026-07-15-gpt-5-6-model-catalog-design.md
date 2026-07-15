# GPT-5.6 Model Catalog Design

## Goal

Expose the GPT-5.6 family anywhere CodexBridge presents a current Codex model catalog, while preserving every existing model and existing provider-backed discovery behavior.

## Design

- Upgrade the bundled `@openai/codex` dependency from `0.142.4` to stable `0.144.4`, whose live `model/list` response exposes `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`.
- Add those three exact IDs to the Codex compatibility catalogs used when live provider discovery is unavailable. Do not add a nonexistent bare `gpt-5.6` ID.
- Prefer `gpt-5.6-sol` for ordinary ChatGPT-authenticated Codex sessions only when `model/list` actually returns it. If it is absent, retain the existing `gpt-5.5` fallback behavior.
- Keep automation jobs on `gpt-5.4-mini`; this update does not change their latency-oriented routing policy.
- Put the three GPT-5.6 IDs first in the Z Token and official OpenAI admin/electron preset lists. Keep their `gpt-5.5` default because support was verified for ChatGPT-authenticated Codex, not for third-party or API-key endpoints.
- Preserve the model-specific metadata reported by Codex `0.144.4`: Sol and Terra support `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`; Luna supports the same list without `ultra`.
- Update current user-facing command examples and localized model descriptions. Historical fixtures, unrelated API examples, and explicitly pinned older-model tests remain unchanged.

## Compatibility

The model string uses the existing Responses/Codex request paths, reasoning-effort handling, and provider validation. No API shape, prompt, credential, persistence, or cache behavior changes.

Remote OpenAI documentation could not be fetched in this environment because the Docs MCP is unavailable and direct official-doc requests return HTTP 403. Exact IDs, descriptions, defaults, and reasoning efforts were verified against the authenticated `model/list` response from the official stable Codex CLI `0.144.4`.

## Testing

- Prove the compatibility catalogs include all three GPT-5.6 IDs with their model-specific reasoning efforts.
- Prove ChatGPT-authenticated Codex sessions prefer `gpt-5.6-sol` when it is listed.
- Prove the rendered admin presets put the GPT-5.6 family first.
- Run focused provider/admin/package tests, root typecheck, build, and diff checks.
