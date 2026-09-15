# MCP Asset Upload Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require first-time human authorization before MCP project asset uploads and optionally remember automatic upload authorization for the current OAuth MCP session.

**Architecture:** Preserve the verified OAuth `session_id` in project MCP contexts. Store `assetUploadAutoExecute` in a server-side session/project preference keyed by user, OAuth client, session, and project. `prepare_project_asset_uploads` gates the first call and accepts the user's explicit choice; `complete_project_game_asset_uploads` requires a one-batch confirmation when automatic authorization is disabled.

**Tech Stack:** Supabase Postgres migrations/RPC, Deno MCP Edge Function, Zod schemas, existing MCP tool result/error contracts.

## Global Constraints

- The preference is scoped to the current OAuth MCP session and project only.
- It must not reuse or change the generic `autoExecute` setting.
- No signed upload URL or storage write is issued before the first authorization choice.
- `confirmUpload: true` confirms only the current batch and does not enable future automatic uploads.
- Legacy contexts without a verified OAuth session never receive persistent automatic authorization.

---

### Task 1: Carry OAuth session identity into project contexts

**Files:**
- Modify: `supabase/functions/mcp/auth.ts`
- Modify: `supabase/functions/mcp/context.ts`
- Modify: `supabase/functions/mcp/account-projects.ts`
- Test: `supabase/functions/mcp/auth.test.ts` and existing account/project context tests as needed

- [x] Add optional `sessionId: string | null` to project auth/context types.
- [x] Populate it from verified OAuth claims in direct project authorization and inherit it when deriving a project context from an account context.
- [x] Keep it non-secret and do not expose bearer tokens in enumerable context data.
- [x] Run the focused Deno auth/context tests.

### Task 2: Add session-scoped asset upload preference RPCs

**Files:**
- Create: `supabase/migrations/20260913100000_mcp_asset_upload_confirmation.sql`
- Test: `tests/unit/mcp-asset-upload-confirmation-migration.test.ts`

- [x] Create a locked-down table keyed by `(session_id, project_id)` with `user_id`, `client_id`, `asset_upload_auto_execute`, and timestamps, referencing `auth.sessions` and `projects`.
- [x] Add security-definer `mcp_get_asset_upload_auto_execute(project_id)` returning nullable boolean and `mcp_set_asset_upload_auto_execute(project_id, enabled)` returning boolean.
- [x] Validate `auth.uid()`, JWT `session_id`/`client_id`, and the matching live OAuth session in both functions; revoke direct table/function access and grant only authenticated execution.
- [x] Add migration assertions for table constraints, RLS/privileges, and both RPC names.

### Task 3: Add confirmation gate to project asset MCP tools

**Files:**
- Modify: `supabase/functions/mcp/errors.ts`
- Modify: `supabase/functions/mcp/write-tools.ts`
- Test: `supabase/functions/mcp/image-tools.test.ts`

- [x] Add `ASSET_UPLOAD_CONFIRMATION_REQUIRED` to the public MCP error codes.
- [x] Add optional `assetUploadAutoExecute` to `prepare_project_asset_uploads`; when unset and no preference exists, return a structured confirmation-required error without creating signed URLs.
- [x] When explicitly `true` or `false`, persist the session preference when a verified session exists, then continue preparing targets; report whether later completion confirmation is required.
- [x] Add optional literal `confirmUpload: true` to `complete_project_game_asset_uploads`; require it when the stored preference is false or unavailable, while keeping true preference automatic.
- [x] Ensure one-batch confirmation never mutates the stored preference and preserve existing item-level verification/idempotency behavior.
- [x] Add tests for first prompt/no storage call, enable-and-continue, disabled-per-batch confirmation, and automatic subsequent completion.

### Task 4: Document and verify the contract

**Files:**
- Modify: `docs/superpowers/specs/2026-09-11-unified-project-asset-upload-design.md`
- Modify: `supabase/functions/mcp/account-tools.test.ts`
- Modify: `supabase/functions/mcp/server.test.ts`

- [x] Document the first-call choice, session scope, one-batch `confirmUpload`, and behavior when session identity is unavailable.
- [x] Update tool registration/allowlist assertions for the new arguments and error behavior.
- [x] Run focused Deno tests, TypeScript checks, and the repository validation command available in `package.json`.
- [x] Review the final diff for authorization bypasses, cross-session leakage, and backwards-incompatible tool schema changes.
