---
name: keco-create-character-animation
description: Use when a user asks to create a PixelLab pixel character, generate character animations, or produce a verified horizontal spritesheet through Keco; not for generic images, Soul identity training, or Godot gameplay implementation.
---

# Create Keco Character And Animation Assets

Read the [shared interaction contract](../../references/interaction-contract.md)
before every user-visible exchange. Keco is authoritative for drafts, paid
generation state, hashes, and storage; never call PixelLab directly.

Before expensive or mutating work, summarize Goal, Source, Scope, Success, and
Next. Use the user's language for that summary and for progress limited to
Completed, Current, Next, and Blocker. Keep IDs, hashes, write tokens, raw MCP arguments,
and evidence out of prose unless needed for verification. Keep tokens, provider payloads,
signed URLs, and raw credentials out of prose.

## Scope and routing

Use this Skill for a standalone Keco character or animation asset workflow:

- text description -> character draft -> verified transparent PNG;
- a ready Keco character -> animation draft -> verified horizontal spritesheet.

Route requests that also implement or evaluate a Godot gameplay Slice to
`keco-develop-godot-slice-v2`, which may invoke this workflow as its typed asset
subtask. Route generic non-Keco image generation to the relevant image skill.
Animations must reference a ready character asset in the same project and use
its recorded SHA-256; never create a new still character for each motion.

## Required state sequences

Character:

`DISCOVER -> CREATE_DRAFT -> REVIEW -> PREPARE -> SHOW_FEE_NOTICE -> USER_CONFIRM -> START -> POLL -> READ_BACK -> REPORT`

Animation (repeat the paid sequence as a separate job):

`RESOLVE_READY_CHARACTER -> CREATE_DRAFT -> REVIEW -> PREPARE -> SHOW_FEE_NOTICE -> USER_CONFIRM -> START -> POLL -> READ_BACK -> REPORT`

`USER_CONFIRM` is always a later user message after showing the exact returned
`feeNotice`. Intent, urgency, or a previous confirmation never authorizes a
paid `start_character_asset_generation` call.

## Workflow

1. **DISCOVER**: call `list_character_assets` and resolve one writable
   `projectId` on account mode. On project mode, omit `projectId` from tool
   arguments. Confirm the source character before planning animation.
2. **CREATE_DRAFT**: validate the typed `plan` and call
   `create_character_asset_draft` with a fresh UUID `idempotencyKey`.
   Character plans require a square 32/64/96/128 transparent PNG target.
   Animation plans require a ready source character, matching SHA-256, an even
   frame count from 4 to 16, frame dimensions divisible by 4, and FPS 1-60.
3. **REVIEW**: call `read_character_asset`, show the human-readable plan, and
   use `update_character_asset_draft` with the current `saveVersion` if the
   user changes it. Any edit invalidates earlier confirmations.
4. **PREPARE**: call `prepare_character_asset_generation`. This freezes the
   plan fingerprint and returns `attemptId`, `generationId`, `attemptCount`,
   `confirmationPurpose`, `feeNotice`, and a short-lived token. Do not submit
   to the provider in this step.
5. **SHOW_FEE_NOTICE / USER_CONFIRM**: show the fee notice and the exact plan
   summary, but never print the confirmation token. Pause for explicit paid
   confirmation.
6. **START**: after confirmation, call `start_character_asset_generation`
   with the exact IDs, fingerprint, attempt count, token, and literal
   `confirmPaidGeneration: true`.
7. **POLL**: editors/admins call `advance_character_asset_generation`; use
   `get_character_asset_generation` for provider-free reads. Continue until
   `ready`, `failed`, or `blocked`. Polling never creates a new paid job.
8. **READ_BACK**: after `ready`, call `read_character_asset` and verify the
   stored PNG/spritesheet dimensions, transparency, SHA-256, and persisted
   generation identity. For animation, verify width is `frameCount *
   frameWidth` and height is `frameHeight`.
9. **REPORT**: report only verified Keco state, storage metadata, and any
   actionable terminal error. Do not claim visual quality from metadata alone.

## Error handling

Pass through the MCP tool's structured error without replacing it with a
generic failure. Use the returned stable `code` and message:

- `FIELD_VALIDATION_FAILED`: correct the plan and create/update the draft;
- `PROJECT_WRITE_FORBIDDEN`: use an admin/editor project context;
- `CHARACTER_ASSET_NOT_FOUND`, `SOURCE_CHARACTER_UNAVAILABLE`, or
  `CHARACTER_ASSET_REVISION_STALE`: re-list/read and resolve the current asset;
- `PROVIDER_CAPABILITY_MISSING` or `PROVIDER_AUTHENTICATION_FAILED`: stop and
  report provider configuration; do not retry paid submission;
- `PROVIDER_RATE_LIMITED` or `PROVIDER_QUOTA_EXCEEDED`: wait or replenish
  credits, then prepare again before any retry;
- `CHARACTER_PROVIDER_JOB_FAILED` or `INVALID_PROVIDER_OUTPUT`: report the
  failed/invalid result and prepare a new attempt only after reviewing the
  plan;
- `CHARACTER_SUBMISSION_UNKNOWN`: do not retry automatically; explain that a
  duplicate charge is possible and require the explicit replacement flow;
- `CHARACTER_CONFIRMATION_REQUIRED`, `CHARACTER_CONFIRMATION_EXPIRED`, or
  `CHARACTER_CONFIRMATION_MISMATCH`: prepare again and obtain a later
  confirmation;
- `CHARACTER_GENERATION_BLOCKED` or `UPSTREAM_UNAVAILABLE`: preserve the
  checkpoint and report the exact stable code; never claim success.

Never expose provider credentials, signed URLs, confirmation tokens, raw
provider responses, or internal stack traces.

## Tool reference

| Purpose | Tool |
|---|---|
| Discover/read assets | `list_character_assets`, `read_character_asset` |
| Create/update draft | `create_character_asset_draft`, `update_character_asset_draft` |
| Prepare paid attempt | `prepare_character_asset_generation` |
| Start after confirmation | `start_character_asset_generation` |
| Read/advance job | `get_character_asset_generation`, `advance_character_asset_generation` |
