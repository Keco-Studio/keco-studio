---
name: keco-manage-game-design-system
description: Use when a user asks to discover, create, generate, version, inspect, or bind a Keco Game Design System; not for deleting design systems or general document and table editing.
---

# Manage Keco Game Design Systems

Manage owned GDS definitions and explicit project version bindings through the
Keco MCP. Read the [GDS and Map MCP contract](../../references/gds-map-mcp-contract.md)
before calling tools. Follow the [shared interaction contract](../../references/interaction-contract.md).

Before expensive or mutating work, state Goal, Source, Scope, Success, and Next.
Use the user's language for Completed, Current, Next, and Blocker updates. Keep
IDs, hashes, write tokens, raw MCP arguments, and evidence out of prose unless
they are needed for verification.

Required state sequence:

`DISCOVER -> READ -> PLAN -> MUTATE -> POLL -> READ_BACK -> REPORT`

For an end-to-end project GDD request, use the extended sequence:

`DISCOVER -> READ_GDS -> PLAN -> MUTATE_GDS -> POLL_GDS -> BIND -> GENERATE_GDD -> POLL_GDD -> READ_GDD -> REPORT`

1. DISCOVER: inspect available tools. On an account endpoint, use
   `list_projects` only when a project binding is involved. Use
   `list_game_design_systems` with pagination and resolve stable IDs from the
   results. Never select by title alone.
2. READ: call `read_game_design_system` for the target. For a binding operation,
   also call `read_project_game_design_system`.
3. PLAN: describe the exact system/version/binding mutation. Preserve returned
   parent and current version IDs. Generate a new idempotency key for new intent;
   reuse it only for the same request.
4. MUTATE: choose exactly one of `create_game_design_system`,
   `generate_game_design_system`, `create_game_design_system_version`,
   `set_project_game_design_system`, or `clear_project_game_design_system`.
5. POLL: when a generation job is returned, call
   `get_game_design_system_generation` until `completed` or `failed`. Use bounded
   waits and report a terminal failure without inventing a replacement write.
6. READ_BACK: verify every mutation through a fresh MCP read. Use
   `read_game_design_system` for system/version changes and
   `read_project_game_design_system` for binding changes.
7. REPORT: state the verified system, version, binding, and job result. Distinguish
   completed writes from proposals and unresolved blockers.

For the extended project GDD sequence:

1. READ_GDS: read the selected system and version with
   `read_game_design_system`, then read the current project binding with
   `read_project_game_design_system`.
2. MUTATE_GDS and POLL_GDS: create or revise the GDS only when the request needs
   it. Poll `get_game_design_system_generation` to a terminal result before using
   a generated version.
3. BIND: call `set_project_game_design_system` with the exact selected system and
   version, then verify both identities with a fresh
   `read_project_game_design_system` call.
4. GENERATE_GDD: call `generate_project_gdd` with the bound `designSystemId`,
   `versionId`, mode, optional creative brief, and a new idempotency key.
5. POLL_GDD: call `get_project_gdd_generation` with bounded waits. `queued`,
   `running`, and `waiting_for_maps` are non-terminal and are not a complete GDD.
   Terminal results are `completed`, `completed_with_map_failures`, and `failed`.
   Use `cancel_project_gdd_generation` only when the user requests cancellation or
   the active job should be stopped; then read the resulting job state.
6. READ_GDD: for a completed result, take the returned `output_document_id` and
   call `read_document` in the same project. Do not claim completion until this
   fresh read returns the generated GDD. Keep map failures visible when the job is
   `completed_with_map_failures`.
7. REPORT: state the verified GDS version, binding, job terminal state, generated
   document identity, and any map failures or blockers.

Stop on an idempotency conflict, stale version, missing identity, or ambiguous
project. Re-read current state before proposing a new action. Never delete GDS
data: no delete operation exists, and clearing a project binding does not delete
the system or version.

## Tool Reference

| Purpose | Tool |
|---|---|
| Discover systems | `list_game_design_systems` |
| Read one system | `read_game_design_system` |
| Read project binding | `read_project_game_design_system` |
| Poll generation | `get_game_design_system_generation` |
| Create structured system | `create_game_design_system` |
| Generate system | `generate_game_design_system` |
| Create immutable version | `create_game_design_system_version` |
| Pin project version | `set_project_game_design_system` |
| Clear project binding | `clear_project_game_design_system` |
| Generate project GDD | `generate_project_gdd` |
| Poll project GDD | `get_project_gdd_generation` |
| Cancel project GDD | `cancel_project_gdd_generation` |
| Read generated GDD | `read_document` |

Common mistakes are guessing IDs, changing input under a reused idempotency key,
continuing after a conflict, reporting a queued job as complete, and treating a
binding clear as deletion. Each is prevented by the required read and read-back
steps.
