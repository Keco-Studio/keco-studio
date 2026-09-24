# Global AI Assistant Design

**Date:** 2026-09-24
**Status:** Approved design, pending implementation plan

## Summary

Keco Assistant currently behaves as a project-local Studio and Script assistant. It is mounted by `DashboardLayout`, hidden from several product workspaces, returns no UI without a route-derived project ID, and rejects new conversations without a project binding.

This design makes Keco Assistant global across the authenticated creative workflow while preserving strict project isolation. The covered workspaces are Projects, all Studio project pages, Script, Create Map, and Game Design Systems. Simulation and administrative or account-management pages remain outside the assistant surface.

The product will expose one consistent assistant icon and one conversation system. Workspace-specific capabilities will be provided through server-enforced Tool bundles. Account-level conversations may list, create, and select projects, but any operation over project content must first bind a new conversation to one uniquely identified project.

## Goals

- Show the same Keco Assistant launcher and panel in all covered workspaces.
- Support useful account-level conversations on Projects and other unbound workspace roots.
- Keep every project-content conversation immutably bound to one project.
- Replace the separate Create Map chat entry with the global assistant entry.
- Add the Projects, Create Map, and Game Design Systems Tools required for feature-complete use.
- Reduce model prompt and request overhead by exposing only the active workspace's Tools.
- Preserve existing permissions, confirmation behavior, idempotency, auditing, and usage accounting.

## Non-Goals

- The assistant will not appear in Simulation, Account, Billing, MCP configuration, Keco Admin, authentication, invitation, OAuth, or payment-result pages.
- A conversation will not silently move between projects or workspaces.
- The first release will not add cross-project content reads or writes.
- The first release will not expose project, map, or Game Design System deletion or Game Design System unbinding Tools.
- The assistant will not synchronously wait for map, Game Design System, or GDD generation jobs to finish.
- The Create Map canvas, saved-map browser, and direct manipulation controls will not move into the chat panel.

## Current-State Findings

- `DashboardLayout` currently hides `ChatPanel` in Simulation, Game Design Systems, Create Map, Keco 101, and Keco Admin.
- `ChatPanel` currently returns `null` when `currentProjectId` is absent, so it is also unavailable on Projects and other account-level pages.
- New agent conversations currently require a valid project ID, and the API rejects global scope.
- `agent_conversations.project_id` is non-null and its RLS policies require project access.
- Create Map currently owns a separate `MapChatPanel` rather than using the global assistant.
- The agent currently sends the full Tool registry to the model and may rebuild the active library schema during every ReAct iteration.
- Retrieval currently performs one embedding request followed by five sequential scope RPC calls.

These are intentional, tested behaviors in the current repository, so globalizing the assistant requires coordinated UI, API, database, Tool, and test changes.

## Considered Approaches

### 1. Display the existing panel on more routes

This is the smallest UI change, but account-level messages would still fail, Create Map and Game Design Systems would lack useful Tools, and the product would be global only in appearance.

### 2. Unified assistant shell with workspace Tool bundles

This is the selected approach. One launcher and conversation system serve all covered workspaces. Account and project scopes remain explicit, and server-side Tool allowlists provide the capabilities relevant to each workspace.

### 3. Fully autonomous cross-project assistant

This would let one conversation discover and mutate multiple projects. It has substantially higher authorization, ambiguity, prompt contamination, and accidental-write risk without a current product requirement, so it is rejected.

## Route Coverage

| Route family | Assistant | Initial scope |
| --- | --- | --- |
| `/projects` | Shown | Account |
| Studio `/<projectId>/...` | Shown | Project, folder, table, or document context |
| `/script-system` | Shown | Account until a project is selected |
| `/script-system/<projectId>/...` | Shown | Project or Script resource context |
| `/create-map` | Shown | Account until the workbench has a verified project |
| `/game-design-systems` and children | Shown | Account; project required for binding or GDD generation |
| `/simulation-system/...` | Hidden | Not applicable |
| `/account`, `/billing`, `/mcp`, `/keco-admin` | Hidden | Not applicable |
| Authentication, invitation, OAuth, payment-result routes | Hidden | Not applicable |

Keco 101 remains outside this approved scope.

## Assistant Host And Presentation

`DashboardLayout` will mount one `AssistantHost`. The host derives a typed workspace context from the current route and decides whether the assistant is supported. Covered routes render the existing Keco Assistant launcher and `ChatPanel`; excluded routes render neither.

All covered pages use the same:

- bot asset;
- launcher size and accessible name;
- floating position and drag behavior;
- open and close behavior;
- panel shell, header, history, composer, confirmation cards, and streaming UI.

Create Map will not display both a floating assistant and `MapChatPanel`. Its standalone assistant entry will be removed. Reusable map-specific UI will become assistant message components such as map-plan previews, generation-status cards, attachments, and generation-history summaries. The map browser and canvas remain part of the Create Map workbench.

The collapsed assistant must not fetch conversations, projects, maps, design systems, embeddings, or model responses. It performs only fixed-cost React state setup, event subscription, and local runtime selection.

## Workspace Context

`AgentWorkspace` expands from `studio | script` to:

- `projects`
- `studio`
- `script`
- `create-map`
- `game-design-systems`

The route-derived context contains the workspace, optional verified project identity, and optional resource identities such as document, library, map, or Game Design System. Client-provided identities are navigation hints only; the server revalidates access and resource ownership before reads, writes, or navigation.

Create Map may use its persisted active-project preference to populate the client context, but the server must independently verify that project on every turn and Tool execution.

## Conversation Scope And Lifecycle

Account-level conversations have `project_id = NULL` and a frozen global scope containing the workspace. They may operate only on account-level resources and the Projects Tool bundle.

Project-level conversations retain the existing immutable binding. Their project is authoritative on every turn regardless of later client navigation.

When the user changes workspace or project:

1. The current conversation remains stored and visible in history.
2. The client activates or creates a draft runtime keyed by user, workspace, and optional project.
3. No model request is sent automatically.
4. The next user message creates a conversation bound to the new context.
5. Returning to the old workspace can restore its prior conversation from history.

Selecting a project from an account-level conversation does not mutate that conversation. `select_project` emits a typed navigation request. After navigation, the UI prepares a new project-bound conversation.

History distinguishes account-level conversations from project conversations and displays the workspace and project label. Legacy conversations without workspace metadata are interpreted as Studio project conversations.

## Tool Architecture

The server builds the model Tool schema from a workspace allowlist. The same allowlist is checked again before execution; filtering only the schema is not a security boundary.

### Account And Projects Tools

- `list_projects`: list accessible projects with role and read/write capabilities. Default 20 results, maximum 50, with pagination.
- `create_project`: create a project through the existing transactional project service. It is a write Tool governed by conversation confirmation mode and idempotency.
- `select_project`: resolve a listed project by stable ID or unambiguous name, revalidate membership, and emit typed navigation. It never accepts an arbitrary URL.

Duplicate project names return candidates instead of selecting the newest, writable, or administrator-owned project.

### Studio Tools

Studio retains the existing project structure, library, field, asset, folder, document, resource-reference, semantic-search, and document-derived generation Tools. Dynamic table schemas are loaded only for Tools that need them.

### Script Tools

Script retains document reads, script import, script-line queries, Story Graph reads and edits, and relevant project discovery Tools. Studio-only mutation Tools are not exposed unless they are explicitly shared by the Script workflow.

### Create Map Tools

- `list_maps`: return bounded saved-map summaries for the bound project.
- `read_map`: return one validated map workspace summary and current generation state.
- `create_map_draft`: reuse the existing V3 planner, idempotent draft claim, and save flow.
- `generate_map_image`: preview the exact plan and fee notice, then submit through the existing signed-confirmation provider flow.
- `get_map_generation_status`: read one generation state without entering an agent polling loop.
- `retry_map_generation`: retry an eligible failure with explicit duplicate-billing acknowledgement where required.

Map image generation and retry always require confirmation, even in Auto mode. Confirmation is bound to user, project, map, revision, asset, generation ID, plan fingerprint, purpose, and expiry.

### Game Design Systems Tools

- `list_game_design_systems`: return bounded summaries with pagination.
- `read_game_design_system`: read one system with bounded version detail and existing source redaction.
- `generate_game_design_system`: enqueue generation using the existing normalized input and job service.
- `copy_game_design_system`: copy an eligible system into the current user's systems.
- `apply_game_design_system`: bind a specific valid version to a uniquely selected project.
- `generate_gdd`: enqueue quick or professional GDD generation from the project's currently pinned version.
- `get_generation_status`: read Game Design System or GDD job status.

Game Design System listing, reading, generation, and copying can run in account scope. Applying a system and generating a GDD require an explicit target project. GDD generation retains the existing warning that it may automatically submit up to three paid map images and always requires confirmation.

### Deferred Tools

The first release does not expose deletion or unbinding Tools. Metadata edits and manual structured Game Design System creation remain UI operations unless a later requirement demonstrates that assistant access is necessary.

## Permissions And Confirmation

- Account-level Tools require an authenticated user.
- Project reads require current membership.
- Project writes reuse existing Viewer, Editor, Admin, and owner checks.
- Game Design System binding remains owner/Admin only.
- GDD generation remains Editor/Admin only.
- Ordinary writes follow the conversation's Auto or Confirm mode.
- Paid operations and destructive operations with an existing always-confirm policy cannot bypass confirmation.
- Every write uses an idempotency key or existing atomic/idempotent domain operation.

No Tool may infer a target project from recency or write capability when names are ambiguous.

## API And Database Changes

The database migration will:

1. Make `agent_conversations.project_id` nullable.
2. Replace conversation RLS policies so account conversations require only conversation ownership, while project conversations additionally require current project access.
3. Add or adjust indexes for user, project, workspace metadata, and updated-time history queries.
4. Keep existing non-null project bindings unchanged.

Agent request handling will:

- accept the expanded workspace enum;
- allow a missing project only for approved account-capable workspaces;
- create a global frozen scope for account conversations;
- continue deriving existing conversation context from the stored binding rather than the request body;
- reject project Tools in account scope with `PROJECT_CONTEXT_REQUIRED`;
- select Tools from the stored workspace and verified scope;
- record account-level AI usage without a project ID.

The history API will support account and project filters without loading all conversations. Conversation DTOs allow a nullable project ID and include a workspace label.

## Navigation Contract

Tools request navigation through an SSE event with an enum-based destination, for example:

```ts
{
  type: 'navigation_requested',
  destination: {
    kind: 'project',
    projectId: 'verified-project-id'
  }
}
```

The server emits navigation only after authorization. The client maps recognized destination kinds to local routes. The model cannot provide or execute arbitrary URLs. A stale or inaccessible destination is rejected and the current page remains unchanged.

## Async Job Behavior

Map, Game Design System, and GDD generation Tools enqueue or submit work and return a durable job or generation identity immediately. The assistant reports only the actual returned state.

The ReAct loop must not poll until completion. The owning workspace may perform bounded background status refresh independently of the model. A later user question may invoke a status Tool once. Failed and interrupted jobs retain their existing retry and recovery semantics.

## Performance Design

Global mounting is fixed-cost and must add no closed-panel network requests. The main latency risks are model round trips, retrieval, Tool schema construction, and unbounded result sets.

### Complexity Bounds

```text
Assistant mount: O(1)
List Tool: O(pageSize), pageSize <= 50
Turn preprocessing: one embedding request plus one batched retrieval operation
Agent task: O((k + 1) * model latency + sum of k Tool operations)
Async generation: O(submission) in the request; generation runs outside the turn
```

`k` is the number of Tool calls selected for the user request. Common workflows should complete in one to three Tool calls.

### Required Optimizations

- Build and cache the workspace Tool schema once per user turn.
- Invalidate the cached dynamic schema only after a schema-changing Tool succeeds.
- Replace five sequential retrieval scope RPCs with parallel scope requests or one batch RPC.
- In account scope, retrieve only same-conversation memory; never search every project.
- Enable project document, table, and project-chat retrieval only after a project is bound.
- Default list Tools to 20 results and cap them at 50.
- Return summaries from list Tools and require specific read Tools for full records.
- Preserve Tool-result compaction and the existing 16,000-character per-result model-context limit.
- Never poll asynchronous jobs inside the ReAct loop.

Adding workspace filtering should reduce Tool schema tokens compared with the current all-Tool registry.

## Error Contract

The assistant uses stable public error codes:

- `PROJECT_CONTEXT_REQUIRED`: the operation needs a selected project.
- `PROJECT_NOT_ACCESSIBLE`: the project is missing or current access is insufficient.
- `PROJECT_NAME_AMBIGUOUS`: more than one accessible project matches.
- `TOOL_NOT_AVAILABLE_IN_WORKSPACE`: the stored workspace does not permit the Tool.
- `CONFIRMATION_REQUIRED`, `CONFIRMATION_EXPIRED`, `CONFIRMATION_MISMATCH`: approval is absent or stale.
- `JOB_QUEUED`, `JOB_RUNNING`, `JOB_FAILED`: durable asynchronous state.
- `NAVIGATION_TARGET_STALE`: the navigation target changed or access was lost.

Losing project access prevents future project reads and Tool execution immediately. The user may retain access to their own conversation metadata and account-level history, but protected project content must not be returned after access is revoked.

## Compatibility And Deployment Order

1. Deploy the nullable project binding, RLS, index, and API compatibility migration.
2. Deploy expanded workspace types, account conversation support, Tool allowlists, and account Tools.
3. Deploy the unified Assistant Host to Projects, Studio, Script, and Game Design Systems.
4. Integrate Create Map Tools and map message cards.
5. Remove the separate Create Map assistant entry only after the unified flow passes end-to-end tests.
6. Remove or update tests that intentionally require the assistant to be hidden on newly covered routes.

Existing project conversations and messages are not rewritten. Existing maps, revisions, assets, generation jobs, design systems, and GDD jobs are not migrated. An unrecognized legacy local runtime key creates a new local runtime without deleting server history.

## Testing Strategy

### Unit And Static Contract Tests

- Route-to-workspace coverage and exclusion matrix.
- One identical launcher component on every covered route.
- No second assistant entry in Create Map.
- Account versus project scope resolution.
- Workspace Tool schema and execution allowlists.
- Dynamic Tool schema cache invalidation.
- Pagination, summary DTO, and result-size limits.
- Typed navigation destination validation.
- Stable error mapping.

### Database And API Tests

- Account conversation insert, select, update, and delete RLS.
- Project conversation behavior before and after membership removal.
- Account conversation creation only in approved workspaces.
- Existing project conversation compatibility.
- Project selection ambiguity and authorization.
- Viewer, Editor, Admin, and owner permission coverage.
- Idempotent project, map, Game Design System, and GDD writes.
- Paid confirmation expiry, fingerprint mismatch, and retry acknowledgement.

### Component And End-To-End Tests

- Projects: list, create, and select a project, navigate, then start a new project conversation.
- Studio: preserve existing library, asset, document, and reference workflows.
- Script: preserve import, query, and Story Graph workflows.
- Create Map: create a draft, preview the plan, confirm paid generation, show durable status, and refresh the workbench.
- Game Design Systems: list, read, generate, copy, bind, and start GDD generation.
- Workspace changes preserve old history and prepare a new context without an automatic model call.
- Refresh, cancellation, confirmation expiry, and lost provider responses do not duplicate writes or billing.

### Performance Tests

- A collapsed assistant performs zero network requests.
- A user turn builds its Tool schema once unless a schema mutation succeeds.
- Retrieval uses one batch or concurrent operation rather than five sequential round trips.
- List Tools never return more than 50 records.
- Async generation returns after submission and never loops in ReAct.
- Prompt Tool payload is smaller in each specialized workspace than the current all-Tool payload.

## Acceptance Criteria

- The same Keco Assistant icon is always available in Projects, all Studio project pages, Script, Create Map, and Game Design Systems.
- Simulation and all explicitly excluded routes do not show the assistant.
- Create Map has exactly one assistant entry.
- Projects supports useful conversation before a project is selected.
- Project data cannot be accessed or mutated until one unique authorized project is bound.
- Changing workspace or project never silently retargets an existing conversation.
- Tool availability and execution are both restricted by stored workspace and verified scope.
- Paid operations always require explicit confirmation.
- The collapsed global assistant adds no network traffic.
- Async generation does not block an assistant turn until completion.
- Existing Studio and Script assistant workflows remain functional.
- All new tests and existing Agent regression tests pass.
