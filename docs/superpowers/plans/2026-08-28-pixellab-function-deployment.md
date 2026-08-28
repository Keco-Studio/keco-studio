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
- [ ] Repeat production deployment, plugin refresh, and real MCP prepare calls.
