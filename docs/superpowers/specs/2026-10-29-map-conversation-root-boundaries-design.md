# Map Conversation Root Boundaries Design

## Problem

The Map conversation version library currently groups every GDD Map produced
by one `gdd_generation_job` into one conversation. Each GDD Map owns a distinct
root Plan and `map_project`, so the current grouping incorrectly presents
separate Maps as `Plan V1`, `Plan V2`, and `Plan V3` iterations of one Map.

The workbench also exposes the current draft's internal
`map_revisions.revision_number` as `Version2`. GDD generation intentionally
uses revision 1 for the immutable generation input and revision 2 for the next
editable draft, but those storage revisions are not user-facing Plan versions.

## Required Semantics

- One Map conversation has exactly one root Plan.
- A root Plan may come from one GDD Map brief or from a user-created Map.
- Different Map briefs from the same GDD generation job create different
  conversations.
- A conversation contains the root Plan and all later Plan branches derived
  from it.
- Selecting a historical Plan as a modification base creates a new immutable
  child Plan in the same conversation.
- Selecting a historical Map as a modification base resolves to that Map's
  owning Plan and creates a new immutable child Plan in the same conversation.
- Existing Plans, Maps, messages, and idempotency records are preserved during
  migration.
- User-facing labels use conversation Plan and Map versions, never storage
  revision numbers.

## Data Model

Add `root_map_project_id` to `map_conversations`, referencing `map_projects`.
The migration adds it as nullable for backfill, then makes it required and
unique. It identifies the Map project owned by the conversation's single root
Plan.

Add a unique partial index that permits only one Plan node with a null
`parent_plan_node_id` per conversation. Node validation also requires that
root Plan's `map_project_id` to equal the conversation's
`root_map_project_id`.

GDD-backed conversations always set `root_map_project_id`. The existing
`gdd_generation_job_id` remains as non-unique provenance metadata so all Maps
created by a GDD job remain traceable without sharing a version tree.

The GDD binding function locates or creates a conversation using the
artifact's `map_project_id` as `root_map_project_id`. It no longer locates a
conversation using only `gdd_generation_job_id`. The first Plan inserted into
that conversation receives `plan_display_version = 1`.

User-created conversations continue to create one root Plan atomically. The
creation RPC records the newly created root project as
`root_map_project_id`; callers do not need to supply it. Follow-up Plans
continue to use the existing conversation ID and parent Plan node.

## Historical Migration

For each existing GDD-backed conversation:

1. Find every Plan node with no `parent_plan_node_id`. Each is a separate root
   tree and therefore a separate conversation.
2. Keep the existing conversation ID for the earliest root tree to preserve as
   many existing links as possible.
3. Create one new conversation for every additional root tree.
4. Move every root's recursive Plan descendants, their Map nodes, referenced
   messages, and completed idempotency requests to the root's conversation.
5. Recalculate `plan_display_version` in original creation order within each
   new conversation, beginning at 1, and set
   `next_plan_display_version = plan_count + 1`.
6. Recalculate message sequence numbers within each conversation while
   preserving their original chronological order.
7. Set each conversation's title from its root Map project and set
   `root_map_project_id` to the root Plan's project.

Messages or incomplete requests that cannot be associated with a Plan tree
remain with the preserved original conversation. No artifact rows, Plan
snapshots, revisions, assets, or node IDs are deleted or recreated.

The migration temporarily disables only the append-only triggers required to
move existing rows, performs all changes in the migration transaction, then
re-enables the triggers and restores the unique indexes.

## Workbench Labels And Selection

The active Plan label comes from the selected conversation Plan node, for
example `Plan V1`.

The canvas label is the Map node whose `revisionId` matches the displayed
image's source revision, for example `Map V1.1`. When no matching generated Map
is displayed, the canvas falls back to the active Plan label.

The Map Plan details panel always shows the active Plan label. It never uses
`draft.identity.revisionNumber`.

Opening a Plan node makes that Plan the active modification base. Opening a Map
node displays its exact output and makes its owning Plan the active
modification base. A subsequent change creates a child Plan and does not mutate
the selected historical node.

## Compatibility And Failure Handling

- `find_map_conversation_by_map_id_v1` continues resolving every Plan branch by
  its `map_project_id`, so saved Map links remain functional after migration.
- The earliest root keeps the former conversation ID. Other Maps are reachable
  through their existing Map IDs and resolve to their newly split conversation.
- Conversation reads and node resolution retain current authorization rules.
- A migration invariant failure aborts the transaction rather than leaving a
  partially split tree.
- Direct user-created conversations and agent-created Map conversations retain
  their existing behavior unless they contain multiple root Plans; the new
  invariant prevents creating a second root in one conversation.

## Verification

Database tests must prove:

- two GDD Map artifacts from one generation job create two conversations and
  both roots are `Plan V1`;
- follow-up Plan and Map descendants remain in the correct root conversation;
- historical grouped data is split without changing node, Plan snapshot,
  revision, asset, message, or request identities;
- Plan and message versions are renumbered locally and append correctly after
  migration;
- a conversation rejects a second root Plan;
- every migrated and newly created conversation has exactly one
  `root_map_project_id` matching its root Plan;
- Map ID lookup resolves the split conversation.

Component tests must prove:

- a GDD Map with current draft revision 2 shows `Plan V1` in Map Plan details;
- the canvas shows `Map V1.1` when the matching generated output is displayed;
- selecting a historical Map uses its owning Plan as the modification base;
- storage revision labels such as `Version2` are not rendered as semantic Map
  or Plan versions.

## Out Of Scope

- merging Plan branches;
- editing historical Plan or Map records in place;
- changing PixelLab generation or pricing behavior;
- grouping all Maps from one GDD into a shared version tree;
- deleting the GDD generation job provenance relationship.
