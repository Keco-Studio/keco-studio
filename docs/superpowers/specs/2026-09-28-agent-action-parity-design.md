# Global assistant action parity

Date: 2026-09-28

## Scope and success criterion

The in-app Keco Assistant must be able to complete the user-facing tasks available in Projects, Studio project pages, Script, Create Map, and Game Design Systems. Simulation and external MCP clients are outside this delivery. A route being visible to the assistant is not action parity: each operation needs a registered Tool, a workspace allowlist entry, authorized execution, a useful result, and a test. The restored Create Map left chat remains the direct map-planning surface; the rail assistant is the cross-workspace surface.

The unit of parity is a user task, not a synthetic click. For example, editing a Script dialogue must use the same atomic document/table/plot synchronization as the UI; a generic table-cell update does not satisfy that task. Browser-only controls such as pan, zoom, panel sizing, and focus do not require Tools. Uploads require a user-provided attachment; the assistant must never invent binary content or infer a local file path.

## Capability inventory

| Workspace | Existing assistant writes | Missing user tasks |
| --- | --- | --- |
| Projects | Create and select project | Edit project metadata; delete project |
| Studio | Create/move/rename/delete documents; create folders/libraries; add fields; asset CRUD; document/graph proposals | Rename/move/duplicate/delete folders; edit/move/duplicate library; edit/delete/reorder fields; collaborator/invitation management; document version restore; game media upload |
| Script | Import script; graph proposal; document-derived generation | Script workspace membership; rename/delete Script; dialogue insert/edit/delete/speaker/reorder/undo with synchronized storage |
| Create Map | Create draft; generate/retry image; read summaries/status | Inspect and edit saved plan/scene; collision grid changes and analysis; reference management; generation history and revision selection |
| Game Design Systems | Generate/copy/apply system; generate GDD; read status | Structured create; metadata/status edit; version create/select; unbind/delete; generation cancellation and retry; GDD job cancellation/retry |

An implementation may use multiple narrowly typed Tools to cover one task. Only operations exposed by the current UI count; placeholder controls do not. Existing read/list Tools stay bounded, with default page size 20 and maximum 50.

## Architecture

New Tools live in `src/lib/agent/tools/`, register in `index.ts`, and appear only in the appropriate `workspace-policy.ts` allowlist. They call existing domain services or the same server-side transaction/RPC as the UI; they do not issue self-HTTP requests to Next routes. Every target is a stable ID or an unambiguous name resolved under the frozen conversation scope. The Tool independently revalidates user membership, role, project ownership of resources, and expected revision at execution, including after a confirmation pause. Account-scope Tools that target a project require an explicit project ID and perform their own access check.

Read Tools return bounded summaries; detail Tools fetch one selected resource. Mutations return stable IDs, changed revision, and invalidations so the open workspace refreshes. Asynchronous paid generation returns a job identity immediately; the ReAct loop never polls to completion. Avoid adding every Tool schema to every workspace or loading unrelated schemas when the panel is closed.

## Confirmation and concurrency

Deletion, irreversible schema changes, restoring an older version over current content, replacing an existing map/GDS version, and paid generation always require a server-side confirmation pause, even in Auto mode. The approval preview names the exact target and consequence; after approval, the Tool rechecks permissions and an expected version/fingerprint to reject stale approval. Ordinary additive create/edit actions follow the conversation's Auto/Confirm setting. All writes use an idempotency key or an existing atomic/idempotent domain operation. Existing `delete_asset` and `delete_library` must receive the same always-confirm policy as `delete_document`.

## Delivery order

1. Close existing confirmation gaps and preserve the verified UI baseline.
2. Projects and Studio structural/schema operations.
3. Script workspace and dialogue operations, preserving its atomic synchronization.
4. Create Map saved-draft, collision, reference, and history operations.
5. Game Design System lifecycle and job operations.
6. Attachments/media and collaborative version operations, then full cross-workspace review.

Each tranche has unit tests for allowlist, authorization, confirmation, ambiguous targets, and service behavior, plus browser checks for at least one real mutation and refresh. The final review compares every capability-inventory row with the current UI and reports any residual gaps explicitly. No TDD is used; tests follow implementation, then one unified review is performed as requested.

## Separate risk

The external MCP API is not the in-app assistant and is not changed by this design. Its professional GDD submission and map overwrite paths currently lack the in-app confirmation pause; this must be tracked as a separate security issue rather than misrepresented as covered by the in-app Tool policy.
