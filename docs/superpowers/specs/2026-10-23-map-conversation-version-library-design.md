# Map Conversation Version Library

**Date:** 2026-10-23

**Status:** Proposed

## Goal

Let one Map conversation retain multiple user-directed Plan alternatives. Each
new modification starts from a Plan explicitly selected by the user, creates a
new immutable Plan asset, and optionally produces a Map PNG asset beneath that
Plan. No later request may overwrite an earlier Plan or Map.

The version library is persistent, visible to authorized project collaborators,
and remains available after a page refresh or new login.

## Product Rules

- A Plan is an asset even before it has a generated PNG.
- A Map is an output asset of exactly one Plan; opening a Map opens that Plan
  and shows that Map output.
- Every new conversational modification must identify one existing Plan as its
  base. The user chooses that base in the version library before the request is
  submitted. The first Plan in a conversation has no base.
- A new request produces a new Plan asset. It never mutates its base Plan.
- The version library labels Plan nodes in conversation creation order (`Plan
  V1`, `Plan V2`, and so on). These labels are separate from the existing
  per-map revision number and immutable Plan snapshot number.
- A generated Map belongs beneath its originating Plan. A failed, queued, or
  generating Map remains visible beneath that Plan with its current state.
- Project image references remain shared project resources. A Plan stores the
  selected reference IDs and SHA-256 values in its immutable snapshot, so later
  library changes cannot change historical output or a retry.
- Map generation remains explicit and paid as it is today. Creating a Plan does
  not call PixelLab.

## User Experience

The existing button immediately to the right of Create Map's plus button
becomes the **version library**. It is not a separate project-level side panel.

```text
Version library
  Plan V1
  Plan V2
    Map V2.1  Ready
  Plan V3
    Map V3.1  Generating
```

Selecting a Plan opens its immutable Plan details and makes it available as a
base for the next message. Selecting a Map opens the same owning Plan with the
selected image, generation status, and download action. A Plan without a Map
still opens normally and can be used as a base or generated independently.

Before the chat composer sends a modification, it shows a required base-Plan
selector. The selected node is named in the pending request. For a new empty
conversation, the composer creates the first Plan without a selector. A user
can cancel selection without changing the conversation.

The existing project reference panel continues to manage images. When a Plan is
open, it shows the reference snapshot used by that Plan; changing references
while composing a new request only affects the newly created child Plan.

## Data Model

The existing `map_projects`, `map_revisions`, `map_plan_versions`, and
`map_assets` tables remain the source of truth for each Plan's editable Draft,
immutable Plan snapshot, and provider lifecycle. A conversation branch gets a
distinct `map_project`; this preserves the current one-current-Draft and
optimistic-save contracts without turning `map_revisions` into a DAG.

New persistent records:

| Record | Purpose |
| --- | --- |
| `map_conversations` | Project-scoped conversation identity, title, creator, timestamps, and the next display version number. |
| `map_conversation_nodes` | Immutable asset-tree nodes. A `plan` node identifies its parent Plan node, owning `map_project`, and immutable `map_plan_version`. A `map` node identifies its owning Plan node, generated `map_revision`, and `map_asset`. |
| `map_conversation_messages` | Durable user and assistant messages, ordered within a conversation. A request message records its selected base Plan node; artifact messages record the resulting Plan or Map node. |

Constraints enforce that every node belongs to the same project as its
conversation, a Plan's parent is either null or another Plan in the same
conversation, and a Map node references an asset/revision from the Map project
of its owning Plan node. Nodes and message content are append-only. Provider
state stays on the existing `map_assets` record and is not duplicated.

All three tables use project-owner/accepted-collaborator read policies. Only
project admins and editors may create a Plan, send a message, or start a Map
generation. Viewers may read the library and download ready Maps. Direct table
writes stay revoked; security-definer RPCs validate relationships and actor
permissions atomically.

## Creation Flow

```text
User selects base Plan + writes modification
  -> durable user message records selected base node
  -> server reads the base immutable Plan snapshot and its reference hashes
  -> planner produces a new Plan
  -> atomic RPC creates a new map project and Draft
  -> RPC saves immutable Plan V1 for that Draft
  -> RPC inserts the child Plan node and assistant artifact message
  -> client opens the new Plan and refreshes the version library

User chooses Generate for a Plan
  -> existing Plan snapshot becomes that Map project's generating revision
  -> existing PixelLab lifecycle runs unchanged
  -> on asset creation, attach or update the Plan's Map child node
  -> client refreshes the corresponding library row until terminal state
```

The Plan node refers to the immutable `map_plan_versions` record, not merely a
mutable Draft. The existing Draft remains available only for UI compatibility;
future conversational edits always fork from the stored Plan snapshot. A
generation's normal next Draft does not become a new conversational Plan node
until a user asks for a modification and chooses it as a base.

## API and Service Boundaries

New Map conversation service calls provide:

- list and read a conversation asset tree with messages;
- create the first Plan in a conversation;
- create a child Plan from an explicit base Plan node and user request;
- resolve a Plan or Map node to its immutable Plan and selected output;
- attach the first generated Map output to its Plan node; and
- list/select only Plans belonging to the active conversation and project.

The planner API receives a server-resolved base snapshot, never an arbitrary
client-supplied revision payload. The creation RPC applies an idempotency key
per message so retrying a network request cannot create duplicate Plan nodes.

Existing standalone Create Map and GDD-generated Maps remain readable. They do
not need automatic historical conversion. A user can begin a new conversation
from an existing Map; that creates a root Plan node from its immutable snapshot
without mutating the old Map record.

## Failure and Concurrency Behavior

- If a base Plan is deleted, inaccessible, or belongs to another project, the
  request fails before the planner runs.
- If a planner response is invalid, persist only the user message and a failed
  assistant message; no Plan node or Map project is created.
- If persistence conflicts after planning, the atomic RPC returns the existing
  result for the same idempotency key or fails without partial nodes.
- A Map generation failure affects only that Plan's Map child. The parent Plan
  remains selectable and can be generated again through the existing confirmed
  retry behavior.
- A collaborator may add a different child Plan from the same base concurrently.
  Both Plan nodes are valid branches and receive stable ordering by creation
  sequence.
- Opening a historical Plan never sends its stale Draft save version to a
  generation request. Generation uses the node's immutable Plan snapshot and
  creates/uses its own current Draft, preventing the current stale-revision UI
  failure mode.

## UI Components

- Replace the current generation-history menu with a version-library menu that
  lists Plan and Map nodes, supports selection, and reports state accessibly.
- Replace browser-only `chatMessages` state with a query-backed conversation
  message stream; optimistic messages reconcile against durable IDs.
- Add a base-Plan picker to the composer. It shows Plan nodes only and is
  required for every non-root modification.
- Render Plan and Map artifact cards from their persisted node IDs, allowing
  each message to open its exact asset after refresh.
- Keep `Saved maps` as a compatibility browser for standalone Maps. The
  conversation workbench opens a version library rather than flattening branch
  nodes into that list.

## Verification

Tests must prove:

- an admin/editor can create a root Plan and several children from different
  selected bases; a viewer cannot mutate the tree;
- a child Plan retains its parent ID, display sequence, immutable Plan snapshot,
  source tuple, and reference hashes;
- a Plan exists in the version library before Map generation;
- a ready, failed, and in-progress Map attach only to their owning Plan;
- selecting a Map resolves to its owning Plan and exact image asset;
- refreshing/reloading reconstructs messages and the version tree without
  browser-memory state;
- concurrent branches from the same base and idempotent message replay do not
  duplicate artifacts;
- cross-project or stale base-node requests fail before planner/provider work;
- existing direct Create Map, GDD Map generation, Plan version saving, and
  PixelLab lifecycle tests remain green;
- the UI requires a base Plan for non-root requests and exposes Plan-only and
  Plan-with-Map states through keyboard-accessible controls.

## Out of Scope

- deleting or rewriting historical Plan/Map assets;
- merging two Plan branches into one;
- changing PixelLab pricing, confirmation, retry, or storage semantics;
- treating a generated Map as a globally editable project reference image;
- automatic conversion of all historical standalone Maps into conversations.
