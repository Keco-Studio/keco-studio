# Nested Folder, GDS, and Create Map MCP Design

**Date:** 2026-08-21

**Status:** Approved

**Scope:** Keco Studio nested-folder creation, remote Keco MCP capabilities for
Game Design Systems and Create Map V3, and matching Claude/Codex plugin Skills.

**Supersedes:** The nested-folder exclusion in
`2026-07-22-sidebar-tree-interaction-design.md`. Other decisions in that design
remain unchanged.

## Summary

Keco will expose three coherent user workflows:

1. An admin can create a child folder from an existing folder row in the web
   sidebar.
2. An MCP client can manage Game Design Systems and complete the Create Map V3
   lifecycle through stable, bounded tools.
3. The Claude and Codex plugins can orchestrate those tools safely, including a
   mandatory second confirmation before a paid map-image request.

The work ships as one project in sequential phases. The nested-folder UI is
completed first. The MCP contract and implementation are completed and verified
next. Plugin Skills are written only after live MCP capability discovery confirms
the final tool schemas.

## Current State

The database and `folderService.createFolder` already support arbitrary folder
nesting through `parent_folder_id` / `parentFolderId`. The remote MCP already
registers `create_folder`, whose optional `parentFolderId` creates a nested
folder atomically. The web `NewFolderModal` does not accept a parent, and the
folder-row action menu intentionally omitted child-folder creation in the older
sidebar design.

GDS and Create Map V3 are implemented as Keco web features. Their domain
services, authenticated APIs, jobs, and map-generation state machines are not
available as Keco MCP tools. The Keco Claude and Codex plugins connect to the
remote MCP, but neither plugin contains a GDS or full Create Map workflow Skill.
The existing `pixellab-map-assets` Skill creates individual game-art resources;
it is not a full-map workflow and must remain separate.

## Goals

- Add a discoverable child-folder action to every editable folder row.
- Preserve the current folder hierarchy, authorization, duplicate-name, move,
  delete, and routing behavior.
- Expose complete, bounded GDS management over both account-scoped and legacy
  project-bound MCP connections.
- Expose Create Map V3 draft, generation, status, and retry operations
  over MCP.
- Prevent an MCP client from starting a paid map-image request without a fresh,
  resource-bound user confirmation.
- Reuse the existing GDS and map business logic instead of implementing a
  second version in the MCP Edge Function.
- Add matching Claude and Codex plugin Skills after the MCP contract is stable.
- Cover permissions, idempotency, state recovery, response bounds, and plugin
  contract parity with automated tests.

## Non-Goals

- Deleting GDS records through MCP.
- Deleting maps through MCP.
- Adding a separate public-publication state beyond the existing V3 revision
  lifecycle.
- Bypassing paid-generation confirmation.
- Exposing raw PixelLab provider tools or provider responses through Keco MCP.
- Modifying Godot scenes, importing maps into Godot, or collecting Godot runtime
  evidence.
- Replacing the existing `pixellab-map-assets` Skill.
- Refactoring unrelated sidebar, GDS, Create Map, or MCP code.

## Delivery Sequence

The implementation follows this dependency order:

1. Add and verify child-folder creation in the web sidebar.
2. Define public MCP DTOs, error codes, and authenticated app-bridge helpers.
3. Add GDS MCP tools and tests.
4. Add Create Map MCP tools, confirmation protection, and tests.
5. Run local MCP capability discovery against the final server.
6. Add the Claude and Codex plugin Skills against the discovered schemas.
7. Run plugin contract tests and end-to-end acceptance.

MCP and plugin development are not interleaved. The plugins depend on the final
MCP contract and therefore follow it in the same implementation project.

## Nested Folder UI

### Interaction

The existing folder-row `+` action menu gains `Create new folder` as its first
creation action. It is shown only to project owners/admins, matching current
folder-creation authorization. Editors retain their existing document actions
and do not receive folder creation.

Selecting the action opens `NewFolderModal` with the selected folder ID as
`parentFolderId`. Root-level creation continues to open the same modal with a
null parent. On success the sidebar:

- invalidates project folder data;
- expands the parent folder and the created folder;
- clears the pending parent selection; and
- navigates to the created folder using the existing folder route.

The modal title remains `New Folder`. The selected location is established by
the action context, so no second folder picker is added.

### Component Contract

`NewFolderModal` adds:

```ts
type NewFolderModalProps = {
  open: boolean;
  projectId: string;
  parentFolderId?: string | null;
  onClose: () => void;
  onCreated: (folderId: string) => void;
};
```

Submission passes `parentFolderId` to the existing
`folderService.createFolder`. Sidebar state tracks a pending new-folder parent
separately from `selectedFolderId`, because `selectedFolderId` is also used by
table and document workflows. Closing the modal always clears the pending
parent.

No API or schema change is required for the sidebar path. The existing service
validates UUID shape, parent existence, project ownership, and same-location
name conflicts.

## Architecture

The MCP implementation uses a hybrid domain-reuse approach:

```text
Claude/Codex plugin Skill
  -> Keco MCP tool
  -> MCP Edge Function
     -> authenticated Supabase query/RPC for bounded reads and atomic writes
     -> Keco Next API with the original user Bearer token for AI, jobs, and
        paid-generation orchestration
  -> bounded public DTO with stable Keco IDs
```

The MCP Edge Function does not copy Node-only GDS or Create Map logic. It also
does not use a service-role client to bypass the MCP actor. When an app API is
needed, the MCP bridge forwards the original verified Bearer token over HTTPS.
The existing `withAuth` boundary identifies the same user and applies the
normal project/GDS authorization before any internal service-role work occurs.

An MCP bridge helper owns origin validation, request timeout, authorization and
idempotency headers, bounded JSON decoding, and safe error translation. GDS and
map tools call this helper rather than constructing ad hoc `fetch` requests.

## MCP Contexts

Both public MCP connection forms remain supported:

- Account-scoped `/mcp`: project-oriented tools require an explicit
  `projectId`.
- Legacy project-bound `/mcp/{projectId}`: the project ID comes from the
  authorized connection context and cannot be overridden by tool input.

Account-scoped and legacy registrations share the same implementation. A
registration helper adds `projectId` to account schemas and omits it from legacy
schemas, following the existing write-tool pattern.

## Folder MCP Contract

The existing `create_folder` tool is the only folder-creation tool. Its current
optional `parentFolderId` remains the canonical way to create a child folder;
this project does not add an alias or a second nesting tool. Focused regression
tests and MCP documentation must demonstrate both root creation with a null
parent and child creation with a folder ID, followed by
`list_project_structure` read-back verification.

## GDS Tool Contract

### Read Tools

`list_game_design_systems`

- Lists the authenticated user's visible official, owned, and otherwise
  permitted systems.
- Returns bounded summaries, current version identity, source, ownership,
  status, migration status, and timestamps.
- Supports deterministic pagination when the result exceeds one response.

`read_game_design_system`

- Reads one visible GDS by stable ID.
- Returns metadata, the current visible version, a bounded version history, rule
  document, rendered Markdown, diff/conflict summary, and supported Art Style.
- Applies the existing viewer source-redaction policy.

`read_project_game_design_system`

- Reads the exact GDS/version currently pinned to a project.
- Requires project read access and returns null when no system is bound.

`get_game_design_system_generation`

- Reads one generation job owned by the authenticated user.
- Returns job ID, status, phase, attempt information, public error, resulting
  system ID, and resulting version ID.

### Write Tools

`create_game_design_system`

- Creates an owned GDS from a complete, validated structured rule set.
- Returns the system and initial version identities.
- Does not accept raw database columns or owner IDs.

`generate_game_design_system`

- Starts the existing AI generation workflow with an explicit idempotency key.
- Accepts the same validated source/reference/art-style domain input as the web
  workflow, projected into a bounded MCP schema.
- Returns immediately with the generation job identity and current status.

`create_game_design_system_version`

- Creates a new version under an explicit owned system and parent version.
- Requires an idempotency key and the existing public version request schema.
- Preserves conflict and rule-reintroduction validation.

`set_project_game_design_system`

- Binds an explicit system/version pair to a project.
- Requires owner/admin project access, matching version lineage, and no
  unresolved version conflicts.

`clear_project_game_design_system`

- Clears the current project binding.
- Requires owner/admin access and affects no GDS or version rows.

The first release intentionally omits GDS delete and copy tools. Copy can be
added later without changing the lifecycle contract; deletion requires a
separate destructive-operation design.

## Create Map Tool Contract

All MCP-created and MCP-edited maps use schema version 3.

### Read Tools

`list_maps`

- Lists visible V3 maps, optionally bounded to one project.
- Returns map ID, project ID/name, map name, current revision ID, update time,
  and current generation summary.

`read_map`

- Reads one visible map and its current V3 workspace.
- Returns identity/save version, Plan, Scene, source document identity,
  generation asset summary, and a short-lived signed image URL only when a ready
  image exists.
- Does not return storage credentials or raw provider output.

`get_map_generation`

- Reads the exact generation asset by map/revision/asset identity.
- Returns `planned`, `queued`, `generating`, `ready`, `blocked`, or `failed`, a
  public error code, retry classification, and ready-image metadata.

### Draft Tools

`create_map_draft`

- Accepts a project ID, map description, optional source document, optional
  selected Keco map-reference IDs, and an idempotency key.
- Uses the existing V3 planner API, validates the returned Plan/Scene, then uses
  the existing V3 map-project RPC.
- Returns map ID, draft revision ID/number, save version, normalized Plan, and
  Scene. It does not submit image generation.

`update_map_draft`

- Accepts a complete validated V3 Plan/Scene and the caller's current
  `saveVersion`.
- Uses the existing optimistic-lock RPC and returns the next save version.
- A stale save version fails without changing the draft.

### Paid Generation Tools

`prepare_map_generation`

- Validates project access, current map/revision/save state, Plan fingerprint,
  dimensions, references, and provider readiness.
- Uses the existing `publish_map_revision_v3` transition to freeze the exact
  generation revision as `generating` and create the next editable draft. In
  this schema, "publish" is an internal revision-freeze operation, not a public
  release action.
- Creates or reuses the exact `planned` direct-map asset for the revision.
- Returns asset ID, immutable generation identity, public fee notice, expiry,
  and a signed confirmation token.
- Makes no paid provider request.

`start_map_generation`

- Requires `confirmationToken` and literal `confirmPaidGeneration: true`.
- Revalidates every token binding and expiry before atomically transitioning the
  planned asset into the provider submission state.
- Returns immediately with asset ID and current generation status.
- Replaying the same valid request returns the existing job/status and never
  submits a second provider request.

`retry_map_generation`

- Retries only states currently classified as safely retryable by the direct-map
  lifecycle.
- A provider submission with unknown outcome is not silently retried. Any action
  that may create a second paid request requires a new preparation and user
  confirmation bound to the current asset state.

## Paid Confirmation Contract

The confirmation token is short-lived and binds at least:

- actor user ID;
- project ID;
- map ID;
- revision ID;
- asset ID;
- generation ID;
- Plan fingerprint;
- confirmation purpose/version; and
- issued/expiry timestamps.

Token verification uses a server secret that is never returned or logged. A
valid signature alone is insufficient: `start_map_generation` also verifies the
current authenticated actor, project role, revision, Plan fingerprint, asset
state, and immutable generation identity.

The database asset transition is the replay boundary. Only the expected planned
state may submit. If the same request arrives again after a successful
transition, it returns the already-associated provider state. If the Plan,
revision, asset identity, role, or token purpose changed, the operation fails
before provider contact.

The plugin must show the returned fee notice and obtain a new explicit user
confirmation. Earlier statements such as "generate the map" do not confirm the
unseen paid request.

## Authorization

| Operation | Admin/owner | Editor | Viewer |
|---|---:|---:|---:|
| Create child folder | Yes | No | No |
| Read visible GDS | Yes | Yes | Yes, redacted as applicable |
| Create GDS | Authenticated user becomes owner | Authenticated user becomes owner | Authenticated user becomes owner |
| Generate/version GDS | Only the GDS owner | Only the GDS owner | Only the GDS owner |
| Bind or clear project GDS | Yes | No | No |
| List/read visible maps | Yes | Yes | Yes |
| Create/update/generate/retry map | Yes | Yes | No |

Every project operation is checked at execution time. The MCP role captured at
connection authorization is not treated as permanently current. App API calls
perform their normal authorization, and direct database work remains protected
by RLS/RPC authorization.

## Idempotency and Concurrency

- GDS generation and version creation use their existing idempotency contracts.
- Map draft creation receives a caller idempotency key and must return the same
  created identity for an identical replay or `IDEMPOTENCY_CONFLICT` for a
  different payload.
- Map draft updates retain the existing `saveVersion` optimistic lock.
- Map preparation reuses an existing exact planned asset for the same revision,
  generation identity, and Plan fingerprint.
- Map submission relies on an atomic asset-state transition to prevent duplicate
  provider calls.
- `create_folder` remains intentionally non-idempotent. Clients inspect project
  structure before creation and read it back afterward.

## Error Contract

All tool failures use the existing MCP failure envelope with a stable public
code, safe message, `retryable` classification, and relevant public resource
identity/current status where useful. Internal SQL, stack traces, tokens,
provider payloads, and secrets are excluded.

Required public codes include:

- `PROJECT_WRITE_FORBIDDEN`
- `GDS_NOT_FOUND`
- `GDS_JOB_CONFLICT`
- `IDEMPOTENCY_CONFLICT`
- `MAP_NOT_FOUND`
- `MAP_REVISION_STALE`
- `MAP_CONFIRMATION_REQUIRED`
- `MAP_CONFIRMATION_EXPIRED`
- `MAP_CONFIRMATION_MISMATCH`
- `MAP_GENERATION_BLOCKED`
- `MAP_GENERATION_FAILED`
- `PROVIDER_RATE_LIMITED`
- `PROVIDER_QUOTA_EXCEEDED`
- `UPSTREAM_UNAVAILABLE`

Failures preserve completed GDS jobs, map drafts, revisions, and asset state.
The MCP layer performs no implicit deletion or compensating rollback. The caller
uses stable IDs and current state to resume safely.

## Response and Telemetry Boundaries

New tools are classified in MCP protocol telemetry as `read` or `write` and are
included in server registration/allow-list tests. Expensive provider submission
is a write operation and records only bounded Keco identities, timing, result
class, and safe error code.

List responses follow existing MCP response-size and signed-cursor rules. Detail
responses omit or truncate unbounded histories while retaining stable IDs that
permit a follow-up read. Bearer tokens, confirmation tokens, signing secrets,
source secrets, signed upload targets, and raw provider payloads are never
logged.

## Plugin Design

Both `plugins/keco-claude` and `plugins/keco-codex` add equivalent Skills.

### `keco-manage-game-design-system`

This Skill handles visible GDS discovery, structured creation, AI generation,
job polling, version creation, project binding, and final read-back. It requires
stable system/version/project IDs, uses idempotency keys for mutations, stops on
conflicts, and verifies every successful mutation through a fresh read.

### `keco-create-map`

This Skill handles full maps in the Keco Create Map product. It resolves project
and source identities, creates/reads a V3 draft, previews the resulting Plan,
prepares generation, displays the returned fee notice, obtains explicit user
confirmation, submits generation, polls terminal state, reads back the ready
image, and leaves the automatically created next draft editable.

The Skill must not treat a user's initial map request as confirmation of the fee
notice. It must not invent provider tool names or call PixelLab directly.

### Routing Boundary

`keco-create-map` owns complete Create Map V3 output. The existing
`pixellab-map-assets` Skill owns individual Godot art resources such as tilesets,
paths, buildings, and props. Keco-driven gameplay implementation remains in the
Godot Slice Skills. This release does not make `keco-create-map` modify a Godot
project.

Each independently distributable plugin carries a local copy of the MCP
contract reference. Automated parity tests compare normalized tool names,
arguments, error/confirmation rules, and required workflow steps across the
Claude and Codex packages.

## Documentation and Versioning

- Update `docs/mcp/README.md` with the final discovered tool schemas and complete
  GDS/map examples.
- Update MCP capability probes and expected tool lists.
- Bump the MCP server version for the additive capability release.
- Bump both plugin manifests together.
- Document that real paid acceptance is opt-in and must use a controlled test
  account/project.

## Testing

### Folder Tests

- Unit/component tests verify root versus nested modal input, parent propagation,
  role visibility, cleanup on close, parent expansion, and created-folder
  navigation.
- Service tests retain invalid parent, cross-project parent, and same-location
  duplicate coverage.
- Browser E2E creates multiple nested levels, refreshes, and verifies tree and
  breadcrumb/routing persistence.

### MCP and API Tests

- Deno tests cover every tool registration, account/legacy schema difference,
  role gate, original Bearer forwarding, timeout, response bounds, error mapping,
  and telemetry class.
- GDS tests cover visibility/redaction, owned mutation, idempotent replay,
  conflict, job lifecycle, and project binding authorization.
- Map tests cover V3-only creation, optimistic-lock failure, preparation,
  confirmation expiry/mismatch, changed Plan/revision, role changes, atomic
  replay, all generation states, safe retry, unknown outcome, and explicit
  revision freezing during preparation.
- Database behavior tests cover any new RPC or idempotency storage introduced by
  implementation. Existing asset-state transitions are reused where they meet
  this contract.

### Plugin Tests

- Claude and Codex packages expose the same two Skills and normalized workflow
  contract.
- Referenced MCP tool names and arguments match live capability discovery.
- Paid generation cannot be reached in the workflow without the returned fee
  notice and a subsequent explicit user confirmation.
- Generation polling and final read-back are mandatory before success.
- Create Map and PixelLab/Godot asset routing remain unambiguous.

### Acceptance

Normal CI uses deterministic mocks and performs no paid provider requests. The
existing opt-in paid acceptance pattern is extended to exercise prepare,
confirmation, submission, polling, and ready read-back against a controlled
account. A plugin-to-MCP smoke test verifies each Skill's tool sequence after
the remote MCP capability contract is stable.

## Acceptance Criteria

1. An admin can create a child folder from a folder row, and the hierarchy
   persists after refresh.
2. Root and nested folder creation use the same modal/service without changing
   existing permissions.
3. The account and legacy MCP endpoints advertise the approved GDS and Create
   Map tools with their appropriate project context schemas.
4. GDS tools can create/generate, poll, version, bind, clear, and read back while
   enforcing ownership, project role, redaction, and idempotency.
5. Map tools can create/update a V3 draft, prepare generation, require fresh paid
   confirmation, submit once, poll/retry safely, and read the ready image.
6. A replay, stale revision, changed Plan, expired/mismatched token, downgraded
   role, or unknown provider outcome cannot silently create a second charge.
7. Tool failures expose stable public errors and retain resumable resource IDs
   without leaking secrets or internal diagnostics.
8. Claude and Codex plugin Skills match the discovered MCP contract and enforce
   the same confirmation, polling, read-back, and routing rules.
9. Focused folder, MCP, API/database, plugin, type, and build checks pass; paid
   provider acceptance remains explicit and opt-in.
