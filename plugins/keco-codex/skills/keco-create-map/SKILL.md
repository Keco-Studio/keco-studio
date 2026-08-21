---
name: keco-create-map
description: Use when a user asks to create, revise, inspect, generate, or retry a complete saved Keco Create Map V3 map; not for individual Godot tilesets, roads, buildings, props, or collision-only work.
---

# Create Keco Maps

Create and generate one complete persisted V3 map through the Keco MCP. Read the
[GDS and Map MCP contract](../../references/gds-map-mcp-contract.md) before using
the tools. Follow the [shared interaction contract](../../references/interaction-contract.md).

Before expensive or mutating work, state Goal, Source, Scope, Success, and Next.
Use the user's language for Completed, Current, Next, and Blocker updates. Keep
IDs, hashes, write tokens, raw MCP arguments, and evidence out of prose unless
they are needed for verification.

Required state sequence:

`DISCOVER -> RESOLVE_SOURCE -> CREATE_DRAFT -> REVIEW_PLAN -> PREPARE -> SHOW_FEE_NOTICE -> USER_CONFIRM -> START -> POLL -> READ_BACK -> REPORT`

The initial request is intent, not paid confirmation. USER_CONFIRM must be a
later user message after the exact fee notice is shown. Do not merge PREPARE and
START, infer consent from the request, or treat general permission to finish as
paid confirmation.

1. DISCOVER: inspect tool availability and call `list_maps`. On account
   endpoints resolve one writable `projectId`; legacy endpoints omit it.
2. RESOLVE_SOURCE: resolve the requested description and optional project
   document/reference/style asset IDs. Stop if source identity is ambiguous.
3. CREATE_DRAFT: call `create_map_draft` with a new UUID idempotency key. A
   replay must keep identical input.
4. REVIEW_PLAN: call `read_map`, inspect the complete V3 Plan and Scene with the
   user, and use `update_map_draft` with the current `saveVersion` if edits are
   required. On `MAP_REVISION_STALE`, re-read instead of overwriting.
5. PREPARE: call `prepare_map_generation` for the reviewed identity. This must
   not contact the provider. The returned confirmation token is bound to the
   current `attemptCount` and cannot authorize a later attempt.
6. SHOW_FEE_NOTICE: display the returned fee notice without exposing the token.
7. USER_CONFIRM: stop and wait for a later explicit confirmation of that fee.
8. START: only then call `start_map_generation` with the exact immutable IDs,
   fingerprint, token, and literal `confirmPaidGeneration: true`.
9. POLL: editors/admins call `advance_map_generation`, then read persisted state
   with `get_map_generation`, until `ready`, `failed`, or `blocked`. Every
   failed, rate-limited, quota-blocked, or unknown-outcome resubmission requires
   a new PREPARE, shown fee notice, and later confirmation before START.
10. READ_BACK: after `ready`, make a fresh `read_map` call and verify the stored
    map identity, Plan, Scene, and generated asset.
11. REPORT: report only verified persisted state and any terminal blocker.

Never call PixelLab directly and never invent provider tools. Requests for
individual tilesets, roads, buildings, or props belong to
`pixellab-map-assets`, not this complete-map workflow. This Skill does not edit a
Godot scene, delete maps, or claim public publication.

## Tool Reference

| Purpose | Tool |
|---|---|
| Discover maps | `list_maps` |
| Read authoritative map | `read_map` |
| Create draft | `create_map_draft` |
| Save reviewed draft | `update_map_draft` |
| Obtain fee and token | `prepare_map_generation` |
| Start after confirmation | `start_map_generation` |
| Read generation state | `get_map_generation` |
| Advance existing job | `advance_map_generation` |

Common mistakes are starting before a later confirmation, logging the token,
retrying an unknown paid outcome, editing stale revisions, and reporting provider
submission as success. The state sequence prohibits each shortcut.
