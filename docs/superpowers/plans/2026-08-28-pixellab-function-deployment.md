# PixelLab Function Deployment Repair Implementation Plan

> **For agentic workers:** Execute this plan inline as one verified change set. The user explicitly requested no TDD and one commit.

**Goal:** Ensure production deploys the PixelLab map and character Edge Functions required by the paid MCP generation workflows.

**Architecture:** Keep the existing Vercel deployment workflow as the owner of production MCP runtime deployment. Extend its Supabase deployment step to publish both provider functions before publishing the MCP function, and cover the deployment list with a static Jest contract test.

**Tech Stack:** GitHub Actions, Supabase CLI, Jest, TypeScript

## Global Constraints

- Do not change paid-generation confirmation or provider submission behavior.
- Do not use TDD for this repair.
- Commit all repair files once after local verification.
- Verify the merged production function endpoints and real MCP prepare calls.

---

### Task 1: Deploy Every Paid Generation Runtime

**Files:**

- Modify: `.github/workflows/deploy-vercel.yml`
- Create: `tests/unit/mcp/pixellab-function-deployment.test.ts`

**Interfaces:**

- Consumes: Supabase project/access-token setup already present in `deploy-mcp-function`.
- Produces: production deployments for `pixellab-map`, `pixellab-character`, and `mcp`, all with repository-configured JWT behavior.

- [x] Add a static contract test that reads `.github/workflows/deploy-vercel.yml` and requires exactly one deployment command for each required function.
- [x] Add `supabase functions deploy pixellab-map --no-verify-jwt --project-ref "$PROJECT_REF"` before the MCP deployment.
- [x] Add `supabase functions deploy pixellab-character --no-verify-jwt --project-ref "$PROJECT_REF"` before the MCP deployment.
- [x] Run the focused Jest contract test, API typecheck, and repository formatting/lint checks relevant to the changed files.
- [x] Review the final diff and create one commit.
- [x] Push, open a PR, wait for all checks, merge, and wait for the merge commit workflows.
- [x] Refresh the installed Keco plugin from merged `main` and verify real character/map prepare calls through MCP.

---

### Task 2: Synchronize Trusted Service Authorization

The first production retest reached `pixellab-character` but returned
`authorization_failed`. The Vercel caller and the Edge Function had no workflow
contract that guaranteed they used the same service-role credential.

**Files:**

- Modify: `.github/workflows/deploy-vercel.yml`
- Modify: `.github/workflows/README.md`
- Modify: `tests/unit/mcp/pixellab-function-deployment.test.ts`

- [x] Sync the repository `SUPABASE_SERVICE_ROLE_KEY` secret to the production
      Vercel environment before building the application.
- [x] Sync the same value to Supabase as `KECO_SERVICE_ROLE_KEY` before deploying
      either PixelLab Edge Function.
- [x] Extend the static deployment contract test to require both synchronized
      targets and their ordering.
- [x] Verify locally and deliver the repair as one follow-up commit.
- [x] Repeat production deployment and plugin refresh.
- [ ] Repeat real MCP prepare calls after the database repair below.

---

### Task 3: Remove Character Generation RPC Output-Column Ambiguity

The authenticated production preflight now reaches `pixellab-character`
version 2 and returns HTTP 200. The following database RPC fails with SQLSTATE
`42702` because the unqualified `status` predicate can refer to either the
`RETURNS TABLE` output variable or `character_assets.status`. The downstream
transition RPC has the same ambiguity in its asset-status fallback and must be
repaired in the same migration so confirmed generation can advance.

**Files:**

- Create: `supabase/migrations/20260828083000_fix_character_prepare_status_ambiguity.sql`
- Modify: `tests/unit/database/character-animation-migration.test.ts`

**Interfaces:**

- Consumes: the existing `public.prepare_character_asset_generation(uuid, bigint, uuid, text)` signature and authorization behavior.
- Produces: the same prepare and transition RPC contracts with asset fields explicitly bound to the update target.

- [x] Add a forward-only `create or replace function` migration that preserves both RPC signatures and behavior while aliasing their asset update targets and predicates.
- [x] Extend the migration contract test to require both forward repairs, their security settings, and qualified asset fields.
- [x] Reset local Supabase and invoke the RPC as an authenticated writer to verify it returns a planned generation attempt instead of SQLSTATE `42702`.
- [x] Run focused database/service tests, MCP Deno tests, typechecks, lint, and diff validation.
- [ ] Deliver the database repair and regression coverage as one commit, then repeat the PR, merge, plugin refresh, and real character/map prepare verification flow.
