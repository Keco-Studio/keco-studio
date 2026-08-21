# Nested Folder, GDS, and Create Map MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add nested-folder creation to the sidebar, expose complete GDS and safe Create Map V3 workflows through Keco MCP, and ship matching Claude/Codex plugin Skills.

**Architecture:** Reuse the existing folder service and the authenticated Keco web APIs. The MCP Edge Function calls direct Supabase RPCs only for bounded atomic data work and forwards the verified user Bearer token to Keco APIs for GDS jobs and map orchestration. Paid map generation uses a short-lived HMAC confirmation token plus the existing atomic map-asset lifecycle.

**Tech Stack:** Next.js 15 route handlers, React 19, TypeScript, Supabase/PostgreSQL RPC and RLS, Supabase Edge Functions with Deno and MCP SDK, Zod, Jest, Playwright, Markdown plugin Skills.

## Global Constraints

- Use Create Map schema version 3 only.
- Keep `create_folder(parentFolderId)` as the single MCP folder-creation tool.
- Only owners/admins may create folders or change a project's GDS binding.
- Admins/editors may create, update, generate, and retry maps; viewers are read-only.
- Never contact the paid provider before a fresh confirmation token and literal `confirmPaidGeneration: true` are both verified.
- Never expose Bearer tokens, confirmation tokens, signing secrets, raw provider payloads, or storage credentials in logs or tool output.
- Do not add GDS deletion, map deletion, a public publication state, direct PixelLab tools, or Godot scene changes.
- Keep normal CI free of real paid provider requests; real paid acceptance remains opt-in.
- Preserve unrelated worktree changes and the existing untracked `.superpowers/` directory.

---

## File Structure

### Web and Folder Ownership

- `src/components/folders/NewFolderModal.tsx`: accepts the optional parent folder and passes it to `folderService.createFolder`.
- `src/components/layout/Sidebar.tsx`: owns pending child-folder state, menu wiring, invalidation, expansion, and navigation.
- `tests/unit/layout/sidebar-child-folder.test.ts`: static/component contract for child-folder wiring.
- `tests/e2e/specs/nested-folder-create.spec.ts`: browser persistence workflow.

### MCP Domain Ownership

- `supabase/functions/mcp/app-bridge.ts`: the only MCP-to-Keco-app HTTP client; owns origin, timeout, Bearer/idempotency headers, response bounds, and safe failures.
- `supabase/functions/mcp/gds-tools.ts`: GDS tool schemas, registration, app-route mapping, and public DTO projection.
- `supabase/functions/mcp/map-tools.ts`: Create Map tool schemas, registration, app-route mapping, and public DTO projection.
- `supabase/functions/mcp/errors.ts`: additive stable public error codes.
- `supabase/functions/mcp/server.ts`: read/write telemetry classification and domain tool registration.

### Map Server Ownership

- `supabase/migrations/20260821120000_map_mcp_idempotency.sql`: atomic idempotent V3 draft creation.
- `src/lib/server/createMapGenerationConfirmation.ts`: signed confirmation claims and verification.
- `src/lib/server/createMapMcpService.ts`: authenticated list/read/create/update/prepare/start/status/retry operations.
- `src/app/api/mcp/create-map/route.ts`: strict action-union HTTP boundary used by MCP.
- `tests/unit/create-map/create-map-mcp-*.test.ts`: confirmation, service, and route coverage.

### Plugin Ownership

- `plugins/keco-claude/skills/keco-manage-game-design-system/`: Claude GDS workflow.
- `plugins/keco-claude/skills/keco-create-map/`: Claude full-map workflow.
- `plugins/keco-codex/skills/keco-manage-game-design-system/`: Codex GDS workflow.
- `plugins/keco-codex/skills/keco-create-map/`: Codex full-map workflow.
- Each plugin's `references/gds-map-mcp-contract.md`: independently packaged copy of the stable tool contract.
- `tests/unit/plugins/keco-gds-map-plugin.test.ts`: cross-package parity and safety gates.

---

### Task 1: Nested Folder Sidebar Creation

**Files:**
- Modify: `src/components/folders/NewFolderModal.tsx`
- Modify: `src/components/layout/Sidebar.tsx`
- Test: `tests/unit/layout/sidebar-child-folder.test.ts`
- Test: `tests/e2e/specs/nested-folder-create.spec.ts`

**Interfaces:**
- Consumes: `createFolder(supabase, { projectId, name, parentFolderId })` from `src/lib/services/folderService.ts`.
- Produces: `NewFolderModalProps.parentFolderId?: string | null` and folder-menu child creation that expands the parent after success.

- [ ] **Step 1: Write the failing unit contract**

Create a source-contract test that proves the modal forwards `parentFolderId`, the folder action menu supplies `onCreateFolder`, and sidebar state is separate from table/document selection:

```ts
expect(modalSource).toContain('parentFolderId?: string | null');
expect(modalSource).toContain('parentFolderId,');
expect(sidebarSource).toContain('pendingFolderParentId');
expect(sidebarSource).toMatch(/onCreateFolder=\{[\s\S]*folderAddMenu\.folderId/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx jest --runInBand tests/unit/layout/sidebar-child-folder.test.ts`

Expected: FAIL because `NewFolderModal` has no `parentFolderId` prop and the folder-row menu has no `onCreateFolder` callback.

- [ ] **Step 3: Implement the minimal folder wiring**

Add the prop and submission field:

```ts
type NewFolderModalProps = {
  open: boolean;
  projectId: string;
  parentFolderId?: string | null;
  onClose: () => void;
  onCreated: (folderId: string) => void;
};

const folderId = await createFolder(supabase, {
  projectId,
  name: trimmed,
  parentFolderId: parentFolderId ?? null,
});
```

In `Sidebar`, add `pendingFolderParentId`, set it from the folder menu before opening the modal, clear it on close/success, pass it to the modal, and expand both the parent and created folder on success. Root creation explicitly sets it to null.

- [ ] **Step 4: Add the browser test**

Use the existing authenticated project fixture and folder-row action locator to create `World/Region/Town`, reload the page, and assert all three rows and nesting levels remain visible. The test must not create folders as an editor.

- [ ] **Step 5: Run folder verification and commit**

Run: `npx jest --runInBand tests/unit/layout/sidebar-child-folder.test.ts tests/unit/layout/sidebar-nesting.test.ts`

Run: `npx playwright test tests/e2e/specs/nested-folder-create.spec.ts --workers=1`

Expected: focused Jest tests PASS; Playwright PASS when the local E2E stack is available, otherwise report the environment blocker without weakening the test.

Commit:

```bash
git add src/components/folders/NewFolderModal.tsx src/components/layout/Sidebar.tsx tests/unit/layout/sidebar-child-folder.test.ts tests/e2e/specs/nested-folder-create.spec.ts
git commit -m "feat: create nested folders from sidebar"
```

### Task 2: MCP App Bridge and Public Errors

**Files:**
- Create: `supabase/functions/mcp/app-bridge.ts`
- Create: `supabase/functions/mcp/app-bridge.test.ts`
- Modify: `supabase/functions/mcp/errors.ts`

**Interfaces:**
- Consumes: `ProjectMcpRequestContext | AccountMcpRequestContext` with non-enumerable `bearerToken`.
- Produces: `callKecoApp<T>(context, request, dependencies?) -> Promise<T>`.

- [ ] **Step 1: Write failing bridge tests**

Cover exact origin joining, HTTPS production enforcement, Bearer forwarding, optional `idempotency-key`, JSON content type, 15-second abort, a 256 KiB response ceiling, non-JSON failure handling, and safe app-code mapping. Assert no thrown message contains the token.

```ts
const payload = await callKecoApp(context, {
  method: "POST",
  path: "/api/game-design-systems/generation-jobs",
  idempotencyKey: "request-1234",
  body: { title: "Tactics" },
}, { fetch: fakeFetch, origin: "https://keco.test" });
```

- [ ] **Step 2: Run the Deno test and verify RED**

Run: `deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net supabase/functions/mcp/app-bridge.test.ts`

Expected: FAIL because `app-bridge.ts` does not exist.

- [ ] **Step 3: Implement the bridge**

Define a strict request type and dependency seam:

```ts
export type KecoAppRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: `/${string}`;
  body?: unknown;
  idempotencyKey?: string;
};

export async function callKecoApp<T>(
  context: McpRequestContext,
  request: KecoAppRequest,
  dependencies: { fetch?: typeof fetch; origin?: string; timeoutMs?: number } = {},
): Promise<T>;
```

Only accept an `https:` configured origin outside tests/local development. Read bytes before JSON parsing and reject oversized responses. Translate app `{ code, error }` responses through `McpDomainError` without returning response headers or bodies.

- [ ] **Step 4: Add stable error codes**

Extend `MCP_ERROR_CODES` with the approved GDS, map, confirmation, and provider codes. Keep the array as the source of the `McpErrorCode` union so all tool failures remain typed.

- [ ] **Step 5: Run bridge/MCP checks and commit**

Run: `deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net supabase/functions/mcp/app-bridge.test.ts supabase/functions/mcp/results.test.ts`

Run: `npm run check:mcp`

Expected: PASS.

Commit:

```bash
git add supabase/functions/mcp/app-bridge.ts supabase/functions/mcp/app-bridge.test.ts supabase/functions/mcp/errors.ts
git commit -m "feat: add authenticated MCP app bridge"
```

### Task 3: GDS MCP Tools

**Files:**
- Create: `supabase/functions/mcp/gds-tools.ts`
- Create: `supabase/functions/mcp/gds-tools.test.ts`
- Modify: `supabase/functions/mcp/server.ts`
- Modify: `supabase/functions/mcp/server.test.ts`
- Modify: `supabase/functions/mcp/account-tools.test.ts`

**Interfaces:**
- Consumes: `callKecoApp`, account/project MCP contexts, and the existing GDS app routes.
- Produces: nine approved GDS tools with account/legacy project schemas.

- [ ] **Step 1: Write failing tool-registration and route-mapping tests**

Assert these exact names:

```ts
const GDS_TOOLS = [
  "list_game_design_systems",
  "read_game_design_system",
  "read_project_game_design_system",
  "get_game_design_system_generation",
  "create_game_design_system",
  "generate_game_design_system",
  "create_game_design_system_version",
  "set_project_game_design_system",
  "clear_project_game_design_system",
];
```

Verify account project operations require `projectId`, legacy project operations omit it, owned GDS operations have no artificial project parameter, idempotency headers are forwarded, and safe app failures become `toolFailure` responses.

- [ ] **Step 2: Run GDS Deno tests and verify RED**

Run: `deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net supabase/functions/mcp/gds-tools.test.ts`

Expected: FAIL because GDS tools are not registered.

- [ ] **Step 3: Implement GDS schemas and handlers**

Create `registerGdsTools(server, context)` with strict Zod schemas. Map handlers to existing routes:

```text
GET    /api/game-design-systems
GET    /api/game-design-systems/{id}
POST   /api/game-design-systems
POST   /api/game-design-systems/generation-jobs
GET    /api/game-design-systems/generation-jobs/{id}
POST   /api/game-design-systems/{id}/versions
GET    /api/projects/{projectId}/game-design-system
PUT    /api/projects/{projectId}/game-design-system
DELETE /api/projects/{projectId}/game-design-system
```

Project and resource IDs are URL-encoded. Tool responses project only documented public fields and retain stable IDs for polling/read-back.

- [ ] **Step 4: Register telemetry classes**

Add the four GDS reads to `READ_TOOLS` and five mutations to `WRITE_TOOLS`. Register GDS tools for both account and project contexts after their existing base tool sets.

- [ ] **Step 5: Run MCP tests and commit**

Run: `deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net supabase/functions/mcp/gds-tools.test.ts supabase/functions/mcp/server.test.ts supabase/functions/mcp/account-tools.test.ts`

Run: `npm run check:mcp`

Expected: PASS.

Commit:

```bash
git add supabase/functions/mcp/gds-tools.ts supabase/functions/mcp/gds-tools.test.ts supabase/functions/mcp/server.ts supabase/functions/mcp/server.test.ts supabase/functions/mcp/account-tools.test.ts
git commit -m "feat: expose GDS workflows through MCP"
```

### Task 4: Idempotent Create Map V3 Draft RPC

**Files:**
- Create: `supabase/migrations/20260821120000_map_mcp_idempotency.sql`
- Create: `tests/unit/database/map-mcp-idempotency-migration.test.ts`
- Modify: `tests/unit/database/create-map-workbench.rls.behavior.test.ts`

**Interfaces:**
- Consumes: current `map_require_writer` and V3 validation semantics.
- Produces: `create_map_project_v3_idempotent(p_project_id, p_idempotency_key, p_input_hash, source tuple, p_plan, p_scene)`.

- [ ] **Step 1: Write failing migration contract tests**

Assert the migration defines a private request table keyed by `(actor_id, idempotency_key)`, validates a 64-character SHA-256 input hash, returns the original map/revision on identical replay, raises `IDEMPOTENCY_CONFLICT` on changed input, and grants only the RPC to `authenticated`.

- [ ] **Step 2: Run the migration test and verify RED**

Run: `npx jest --runInBand tests/unit/database/map-mcp-idempotency-migration.test.ts`

Expected: FAIL because the migration and RPC do not exist.

- [ ] **Step 3: Implement atomic idempotency**

Create `map_creation_requests` with these immutable columns:

```sql
actor_id uuid not null references auth.users(id) on delete cascade,
idempotency_key uuid not null,
input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
map_id uuid not null references public.map_projects(id) on delete cascade,
revision_id uuid not null references public.map_revisions(id) on delete cascade,
created_at timestamptz not null default now(),
primary key (actor_id, idempotency_key)
```

The security-definer RPC locks an existing request, compares `input_hash`, and returns the original revision identity. For a new request it performs the same validation and inserts as `create_map_project_v3`, then records the result in the same transaction.

- [ ] **Step 4: Add local database behavior coverage**

Extend the behavior test to prove identical replay returns one map, changed replay is rejected, writers are allowed, and viewers are rejected. Skip only through the repository's existing local-Supabase availability guard.

- [ ] **Step 5: Run database tests and commit**

Run: `npx jest --runInBand tests/unit/database/map-mcp-idempotency-migration.test.ts tests/unit/database/create-map-workbench.rls.behavior.test.ts`

Expected: PASS or the established local-database skip for behavior tests.

Commit:

```bash
git add supabase/migrations/20260821120000_map_mcp_idempotency.sql tests/unit/database/map-mcp-idempotency-migration.test.ts tests/unit/database/create-map-workbench.rls.behavior.test.ts
git commit -m "feat: add idempotent V3 map creation"
```

### Task 5: Create Map Confirmation and App API

**Files:**
- Create: `src/lib/server/createMapGenerationConfirmation.ts`
- Create: `src/lib/server/createMapMcpService.ts`
- Create: `src/app/api/mcp/create-map/route.ts`
- Create: `tests/unit/create-map/create-map-mcp-confirmation.test.ts`
- Create: `tests/unit/create-map/create-map-mcp-service.test.ts`
- Create: `tests/unit/create-map/create-map-mcp-route.test.ts`

**Interfaces:**
- Consumes: `createMapPlanV3`, `readCreateMapDocumentSource`, V3 schemas/fingerprint helpers, map RPCs, `pixellab-map`, and `getAgentConfirmationSigningSecret`.
- Produces: one authenticated strict action API for all approved MCP map operations.

- [ ] **Step 1: Write failing confirmation tests**

Use fixed time and secret dependencies. Verify round-trip, 10-minute expiry, tamper rejection, purpose mismatch, user/project/map/revision/asset/generation/fingerprint mismatch, and no secret/token text in errors.

```ts
type MapGenerationConfirmationClaims = {
  version: 1;
  purpose: 'submit' | 'replace-unknown';
  userId: string;
  projectId: string;
  mapId: string;
  revisionId: string;
  assetId: string;
  generationId: string;
  planFingerprint: string;
  issuedAt: number;
  expiresAt: number;
};
```

- [ ] **Step 2: Run confirmation tests and verify RED**

Run: `npx jest --runInBand tests/unit/create-map/create-map-mcp-confirmation.test.ts`

Expected: FAIL because the confirmation module does not exist.

- [ ] **Step 3: Implement signed claims**

Serialize canonical JSON as base64url, sign with HMAC-SHA256, compare signatures with `timingSafeEqual`, strictly parse every claim, and reject expiry at verification time. Export `signMapGenerationConfirmation` and `verifyMapGenerationConfirmation`.

- [ ] **Step 4: Write failing service/route lifecycle tests**

Cover:

- list/read access and V3 filtering;
- idempotent create using planner output and the new RPC;
- update with `saveVersion` conflict mapping;
- preparation freezing a draft with `publish_map_revision_v3`, creating/reusing one V3 asset, and returning a token without invoking PixelLab;
- start requiring both confirmation fields and invoking `submit` once;
- status projection and signed URL only for ready assets;
- safe retry states;
- unknown-outcome replacement requiring a `replace-unknown` token;
- downgraded roles and changed revisions/fingerprints failing before provider contact.

- [ ] **Step 5: Implement `createMapMcpService`**

Expose these exact methods:

```ts
listMaps(input)
readMap(input)
createDraft(input)
updateDraft(input)
prepareGeneration(input)
startGeneration(input)
getGeneration(input)
retryGeneration(input)
```

Preparation freezes the exact draft using the existing V3 revision transition, creates the next editable draft, creates/reuses the planned asset on the frozen revision, and signs the claims. It does not invoke `pixellab-map`. Start re-reads actor role, revision, Plan fingerprint, and asset before calling the Edge Function.

- [ ] **Step 6: Implement the strict route**

Define a discriminated Zod union on `action`:

```ts
z.discriminatedUnion('action', [
  listMapsSchema,
  readMapSchema,
  createDraftSchema,
  updateDraftSchema,
  prepareGenerationSchema,
  startGenerationSchema,
  getGenerationSchema,
  retryGenerationSchema,
]);
```

Wrap POST with `withAuth`, pass the authenticated `supabase` and `user`, return private no-store JSON, and map domain errors to stable HTTP status/code pairs. The route never accepts actor IDs or provider operation names from callers.

- [ ] **Step 7: Run map API tests and commit**

Run: `npx jest --runInBand tests/unit/create-map/create-map-mcp-confirmation.test.ts tests/unit/create-map/create-map-mcp-service.test.ts tests/unit/create-map/create-map-mcp-route.test.ts`

Run: `npm run typecheck && npm run typecheck:api`

Expected: PASS.

Commit:

```bash
git add src/lib/server/createMapGenerationConfirmation.ts src/lib/server/createMapMcpService.ts src/app/api/mcp/create-map/route.ts tests/unit/create-map/create-map-mcp-confirmation.test.ts tests/unit/create-map/create-map-mcp-service.test.ts tests/unit/create-map/create-map-mcp-route.test.ts
git commit -m "feat: add confirmed map generation API"
```

### Task 6: Create Map MCP Tools

**Files:**
- Create: `supabase/functions/mcp/map-tools.ts`
- Create: `supabase/functions/mcp/map-tools.test.ts`
- Modify: `supabase/functions/mcp/server.ts`
- Modify: `supabase/functions/mcp/server.test.ts`
- Modify: `supabase/functions/mcp/account-tools.test.ts`

**Interfaces:**
- Consumes: `callKecoApp` and `POST /api/mcp/create-map` actions.
- Produces: eight approved Create Map tools for account and legacy connections.

- [ ] **Step 1: Write failing map tool tests**

Assert these exact names and annotations:

```ts
const MAP_TOOLS = [
  "list_maps",
  "read_map",
  "create_map_draft",
  "update_map_draft",
  "prepare_map_generation",
  "start_map_generation",
  "get_map_generation",
  "retry_map_generation",
];
```

Verify strict account `projectId` requirements, legacy project injection, literal `confirmPaidGeneration: true`, UUID idempotency keys, bounded descriptions/references, full Plan/Scene pass-through bounds, safe response projection, and failure mapping.

- [ ] **Step 2: Run map Deno tests and verify RED**

Run: `deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net supabase/functions/mcp/map-tools.test.ts`

Expected: FAIL because map tools are not registered.

- [ ] **Step 3: Implement map handlers**

Create `registerMapTools(server, context)`. Each handler calls the single app route with the exact action and current project context. `prepare_map_generation` returns the fee notice and token as tool data but its description states that the notice must be shown before the token can be used. `start_map_generation` refuses false or omitted confirmation at schema validation.

- [ ] **Step 4: Register telemetry and server capabilities**

Classify `list_maps`, `read_map`, and `get_map_generation` as reads; classify the other five as writes. Bump the MCP server version from `0.3.1` to the next additive minor version and update expected tool lists.

- [ ] **Step 5: Run MCP tests and commit**

Run: `deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net supabase/functions/mcp/map-tools.test.ts supabase/functions/mcp/gds-tools.test.ts supabase/functions/mcp/server.test.ts supabase/functions/mcp/account-tools.test.ts`

Run: `npm run check:mcp`

Expected: PASS.

Commit:

```bash
git add supabase/functions/mcp/map-tools.ts supabase/functions/mcp/map-tools.test.ts supabase/functions/mcp/server.ts supabase/functions/mcp/server.test.ts supabase/functions/mcp/account-tools.test.ts
git commit -m "feat: expose Create Map workflows through MCP"
```

### Task 7: MCP Discovery, Documentation, and Acceptance Contracts

**Files:**
- Modify: `docs/mcp/README.md`
- Modify: `scripts/probe-mcp-capabilities.ts`
- Modify: `tests/unit/mcp/capabilities-probe.test.ts`
- Modify: `scripts/accept-create-map-v3-paid.ts`
- Modify: `tests/unit/create-map/create-map-v3-acceptance-scripts.test.ts`

**Interfaces:**
- Consumes: final registered MCP schemas.
- Produces: discoverable documentation and opt-in paid lifecycle acceptance.

- [ ] **Step 1: Write failing probe/document tests**

Require all GDS/map tools in capability expectations, require the README to document root/legacy project inputs and paid confirmation, and require the paid acceptance script to exercise prepare before start and poll to a terminal state.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx jest --runInBand tests/unit/mcp/capabilities-probe.test.ts tests/unit/create-map/create-map-v3-acceptance-scripts.test.ts`

Expected: FAIL because the new tools and two-step acceptance are absent.

- [ ] **Step 3: Update probes, docs, and opt-in script**

Document exact argument examples without real tokens or IDs. Keep the paid script behind `KECO_ACCEPTANCE_CREATE_V3=true`, require its controlled project variables, and print only safe Keco IDs/statuses.

- [ ] **Step 4: Run local capability discovery and tests**

Run: `npm run probe:mcp-capabilities -- --help`

Run: `npx jest --runInBand tests/unit/mcp/capabilities-probe.test.ts tests/unit/create-map/create-map-v3-acceptance-scripts.test.ts`

Run: `npm run test:mcp`

Expected: PASS. Do not run the paid acceptance command without explicit credentials and opt-in environment.

- [ ] **Step 5: Commit**

```bash
git add docs/mcp/README.md scripts/probe-mcp-capabilities.ts scripts/accept-create-map-v3-paid.ts tests/unit/mcp/capabilities-probe.test.ts tests/unit/create-map/create-map-v3-acceptance-scripts.test.ts
git commit -m "docs: publish GDS and Create Map MCP contract"
```

### Task 8: Claude and Codex Plugin Skills

**Files:**
- Create: `plugins/keco-claude/references/gds-map-mcp-contract.md`
- Create: `plugins/keco-codex/references/gds-map-mcp-contract.md`
- Create: `plugins/keco-claude/skills/keco-manage-game-design-system/SKILL.md`
- Create: `plugins/keco-codex/skills/keco-manage-game-design-system/SKILL.md`
- Create: `plugins/keco-claude/skills/keco-create-map/SKILL.md`
- Create: `plugins/keco-codex/skills/keco-create-map/SKILL.md`
- Create: `plugins/keco-codex/skills/keco-manage-game-design-system/agents/openai.yaml`
- Create: `plugins/keco-codex/skills/keco-create-map/agents/openai.yaml`
- Modify: `plugins/keco-claude/.claude-plugin/plugin.json`
- Modify: `plugins/keco-codex/.codex-plugin/plugin.json`
- Modify: `plugins/keco-claude/README.md`
- Test: `tests/unit/plugins/keco-gds-map-plugin.test.ts`

**Interfaces:**
- Consumes: the final discovered MCP tool contract from Tasks 3, 6, and 7.
- Produces: equivalent distributable GDS and full-map workflows for Claude and Codex.

- [ ] **Step 1: Invoke required Skill-authoring workflows**

Before editing plugin files, read and follow `skill-creator` and `superpowers:writing-skills`. Use their validation scripts/templates where applicable.

- [ ] **Step 2: Write failing plugin parity tests**

Assert both packages contain both Skills, their normalized tool-name sets match, all referenced names exist in MCP server registration, the map Skill requires fee-notice display plus a later explicit confirmation, polling/read-back are mandatory, and `pixellab-map-assets` remains the route for individual Godot resources.

- [ ] **Step 3: Run plugin test and verify RED**

Run: `npx jest --runInBand tests/unit/plugins/keco-gds-map-plugin.test.ts`

Expected: FAIL because the Skills do not exist.

- [ ] **Step 4: Write the shared contract copies**

Document the exact tool inputs, stable IDs, status transitions, public errors, account versus legacy project context, read-back rules, and paid confirmation sequence. Keep each plugin copy self-contained and byte-equivalent where platform differences do not require metadata changes.

- [ ] **Step 5: Write `keco-manage-game-design-system`**

Required state sequence:

```text
DISCOVER -> READ -> PLAN -> MUTATE -> POLL -> READ_BACK -> REPORT
```

The Skill resolves stable IDs, uses idempotency keys, stops on conflicts, never deletes GDS data, and verifies every mutation through fresh MCP reads.

- [ ] **Step 6: Write `keco-create-map`**

Required state sequence:

```text
DISCOVER -> RESOLVE_SOURCE -> CREATE_DRAFT -> REVIEW_PLAN -> PREPARE
-> SHOW_FEE_NOTICE -> USER_CONFIRM -> START -> POLL -> READ_BACK -> REPORT
```

The Skill treats the initial request as intent, not paid confirmation; never calls PixelLab directly; never invents provider tools; and routes tilesets/roads/buildings/props to `pixellab-map-assets`.

- [ ] **Step 7: Validate and commit plugins**

Run: `npx jest --runInBand tests/unit/plugins/keco-gds-map-plugin.test.ts tests/unit/plugins/keco-claude-plugin.test.ts`

Run the Skill validator specified by the required `skill-creator` workflow for each of the four new Skill directories, then run `npm run typecheck`. Record every exact validator command in the task status before execution so the final report can reproduce it.

Expected: PASS.

Commit:

```bash
git add plugins/keco-claude plugins/keco-codex tests/unit/plugins/keco-gds-map-plugin.test.ts
git commit -m "feat: add GDS and Create Map plugin skills"
```

### Task 9: Final Regression and Acceptance Verification

**Files:**
- Modify only files required to fix regressions introduced by Tasks 1-8.

**Interfaces:**
- Consumes: every deliverable in this plan.
- Produces: fresh completion evidence and a clean scoped diff.

- [ ] **Step 1: Run focused suites**

```bash
npx jest --runInBand tests/unit/layout/sidebar-child-folder.test.ts tests/unit/create-map tests/unit/mcp tests/unit/plugins/keco-gds-map-plugin.test.ts tests/unit/database/map-mcp-idempotency-migration.test.ts
npm run test:mcp
```

Expected: PASS, with only established environment-dependent database skips.

- [ ] **Step 2: Run static verification**

```bash
npm run typecheck
npm run typecheck:api
npm run check:mcp
npm run lint
```

Expected: all commands exit 0; lint may report only the repository's existing warnings and no new errors.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 4: Run browser verification**

Start the existing development/E2E stack on an available port, run the nested-folder Playwright test, and capture the URL used. Do not run real paid generation.

- [ ] **Step 5: Inspect final scope and commit repairs**

Run:

```bash
git status --short
git diff --check
git log --oneline --decorate -12
```

Confirm `.superpowers/` remains untouched and every changed file belongs to the approved design. When regression repairs exist, stage each concrete path reported by `git diff --name-only` individually and commit them with `git commit -m "fix: close GDS and map MCP regressions"`. When no repair diff exists, do not create an empty commit.

- [ ] **Step 6: Report completion**

Report nested-folder behavior, MCP tool groups, confirmation safety, plugin Skills, commits, exact verification commands/results, skipped external paid acceptance, and the local URL used for browser verification.
