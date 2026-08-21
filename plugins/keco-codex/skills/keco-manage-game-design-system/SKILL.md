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

Common mistakes are guessing IDs, changing input under a reused idempotency key,
continuing after a conflict, reporting a queued job as complete, and treating a
binding clear as deletion. Each is prevented by the required read and read-back
steps.
