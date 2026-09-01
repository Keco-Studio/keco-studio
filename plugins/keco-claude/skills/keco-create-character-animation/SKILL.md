---
name: keco-create-character-animation
description: Use when a user asks to create a PixelLab pixel character, generate character animations, or produce a verified horizontal spritesheet through Keco; not for generic images, Soul identity training, or Godot gameplay implementation.
---

# Create Keco Character And Animation Assets

Follow the same workflow and safety rules as the Codex Keco plugin. Read
the [shared interaction contract](../../references/interaction-contract.md) first,
keep Keco authoritative, and
never call PixelLab directly. Use the eight `*_character_asset*` MCP tools for
discovery, typed drafts, two-step paid confirmation, polling, validation, and
read-back.

Before expensive or mutating work, summarize Goal, Source, Scope, Success, and
Next. Use the user's language for that summary and for progress limited to
Completed, Current, Next, and Blocker. Keep IDs, hashes, write tokens, raw MCP
arguments, and evidence out of prose unless needed for verification.
Keep IDs, hashes, write tokens, raw MCP arguments, and evidence in machine
artifacts or an on-request detail view.

Required sequences:

`DISCOVER -> CREATE_DRAFT -> REVIEW -> PREPARE -> SHOW_FEE_NOTICE -> USER_CONFIRM -> START -> POLL -> READ_BACK -> REPORT`

For animation, first resolve a ready source character and repeat the paid
sequence as a separate job. `USER_CONFIRM` must be a later message after the
exact `feeNotice`; never infer paid consent. Preserve and report stable MCP
codes such as `FIELD_VALIDATION_FAILED`, `SOURCE_CHARACTER_UNAVAILABLE`,
`PROVIDER_RATE_LIMITED`, `PROVIDER_QUOTA_EXCEEDED`,
`CHARACTER_PROVIDER_JOB_FAILED`, `CHARACTER_SUBMISSION_UNKNOWN`,
`INVALID_PROVIDER_OUTPUT`, and `UPSTREAM_UNAVAILABLE` instead of collapsing
them into a generic error. Never expose tokens, signed URLs, credentials, or
raw provider payloads.
