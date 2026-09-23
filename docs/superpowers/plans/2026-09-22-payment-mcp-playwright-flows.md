# Payment And MCP Playwright Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove Stripe webhook Credit grants are atomic/idempotent and MCP OAuth enforces viewer/editor/admin permissions end to end.

**Architecture:** Move Stripe event claiming, order mutation, and Credit allocation into one service-role database transaction. Reuse the repository's PKCE/dynamic-client patterns to obtain genuine OAuth tokens, then exercise the deployed MCP JSON-RPC endpoint from Playwright.

**Tech Stack:** Playwright API/browser contexts, Stripe Node SDK, PostgreSQL/Supabase RPC, Supabase OAuth, MCP JSON-RPC.

## Global Constraints

- Do not contact Stripe's network.
- Use signed synthetic Stripe events with a deterministic test webhook secret.
- Use random temporary identifiers and idempotent cleanup.
- Assert explicit required/forbidden MCP tools, not a full-list snapshot.
- Never print access tokens, webhook signatures, or service-role credentials.

---

### Task 1: Atomic Stripe event processing

**Files:**
- Create: `supabase/migrations/20260922010000_atomic_stripe_credit_webhooks.sql`
- Modify: `src/lib/supabase-payments.ts`
- Modify: `src/app/api/webhooks/stripe/route.ts`
- Modify: `tests/unit/payment/supabase-payments.test.ts`
- Create: `tests/unit/database/atomic-stripe-webhook-migration.test.ts`

**Interfaces:**
- Produces: `public.process_stripe_checkout_event(p_event_id text, p_event_type text, p_session_id text, p_status text, p_payment_intent_id text, p_payload jsonb, p_credit_amount bigint)` returning `jsonb` with `{ processed, orderId }`; `p_session_id`, `p_status`, and `p_payment_intent_id` are nullable for non-checkout events.
- Produces: `processStripeCheckoutEvent(input)` in `src/lib/supabase-payments.ts`.

- [ ] **Step 1: Write failing migration and service tests**

Assert the migration claims `payment_webhook_events.id` with `ON CONFLICT DO NOTHING`, locks the matching order, updates status, inserts `credit_ledger_entries` with `stripe-checkout:<session>`, and grants execution only to `service_role`. Mock the RPC and assert exact parameter mapping.

- [ ] **Step 2: Run and verify RED**

Run: `npx jest --runInBand tests/unit/database/atomic-stripe-webhook-migration.test.ts tests/unit/payment/supabase-payments.test.ts`

Expected: FAIL because the migration and service function are absent.

- [ ] **Step 3: Implement the transaction RPC**

Return `{ processed: false, orderId: null }` on duplicate event ID. For a newly claimed payment event, raise if the session has no order, update the order, and insert the Credit grant in the same transaction. Validate `p_status` and require positive `p_credit_amount` only for `paid`.

- [ ] **Step 4: Route every recognized event through the atomic service**

Replace `hasWebhookEvent` plus `updatePaymentOrderFromStripe` plus `recordWebhookEvent` with one `processStripeCheckoutEvent` call. Unknown event types still record atomically with no order mutation and zero Credits.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npx jest --runInBand tests/unit/database/atomic-stripe-webhook-migration.test.ts tests/unit/payment/supabase-payments.test.ts tests/unit/payment/payment-domain.test.ts
git add supabase/migrations/20260922010000_atomic_stripe_credit_webhooks.sql src/lib/supabase-payments.ts src/app/api/webhooks/stripe/route.ts tests/unit/database/atomic-stripe-webhook-migration.test.ts tests/unit/payment/supabase-payments.test.ts
git commit -m "fix: process Stripe Credit webhooks atomically"
```

---

### Task 2: Stripe webhook Playwright replay

**Files:**
- Modify: `playwright.config.ts`
- Create: `tests/e2e/specs/stripe-webhook.spec.ts`
- Test: `tests/e2e/specs/stripe-webhook.spec.ts`

**Interfaces:**
- Consumes: `createTemporaryUser`, `getE2EAdminClient`, payment tables, and `/api/webhooks/stripe`.

- [ ] **Step 1: Add a deterministic web-server secret**

Set `STRIPE_SECRET_KEY` to `sk_test_keco_playwright` only when absent and set `STRIPE_WEBHOOK_SECRET` to `whsec_keco_playwright_20260922` in `webServer.env`.

- [ ] **Step 2: Write the signed webhook test**

Insert one pending `payment_orders` row with a unique `stripe_checkout_session_id`. Serialize one `checkout.session.completed` event, sign it using `Stripe.webhooks.generateTestHeaderString`, POST it once, then replay sequentially and concurrently with `Promise.all`.

```ts
const deliveries = await Promise.all([
  request.post('/api/webhooks/stripe', { data: payload, headers }),
  request.post('/api/webhooks/stripe', { data: payload, headers }),
]);
expect(deliveries.every((response) => response.ok())).toBe(true);
```

- [ ] **Step 3: Assert durable invariants and cleanup**

Query by unique IDs and assert one webhook row, one ledger row, a paid order, stored payment intent, and an allocation delta equal to the plan's `creditAmount`. Delete webhook/order rows and the temporary user in `afterAll`.

- [ ] **Step 4: Audit and apply the linked-project migration**

Run `supabase migration list` and inspect the remote/local columns. Proceed only when the sole new pending migration created by this task is `20260922010000`; if any unrelated local migration is pending, stop and report the ordering conflict. Then run `supabase db push --include-all --yes` against the already linked project.

- [ ] **Step 5: Verify twice**

Run twice: `npx playwright test tests/e2e/specs/stripe-webhook.spec.ts --project=chromium --workers=1`.

Expected: both runs pass and leave zero rows matching the test run UUID.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts tests/e2e/specs/stripe-webhook.spec.ts
git commit -m "test: verify Stripe webhook Credit idempotency"
```

---

### Task 3: OAuth and MCP Playwright helper

**Files:**
- Create: `supabase/migrations/20260922020000_mcp_admin_project_discovery.sql`
- Modify: `supabase/functions/mcp/account-projects.ts`
- Modify: `supabase/functions/mcp/account-tools.ts`
- Modify: `supabase/functions/mcp/write-tools.ts`
- Modify: `supabase/functions/mcp/account-projects.test.ts`
- Modify: `supabase/functions/mcp/account-tools.test.ts`
- Modify: `supabase/functions/mcp/server.test.ts`
- Create: `tests/unit/database/mcp-admin-project-discovery-migration.test.ts`
- Create: `tests/e2e/helpers/mcp-oauth.ts`
- Create: `tests/e2e/helpers/mcp-jsonrpc.ts`
- Test: `tests/e2e/specs/mcp-authorization.spec.ts`

**Interfaces:**
- Produces: `public.mcp_has_admin_project()` and `accountHasAdminProject(context): Promise<boolean>`.
- Changes: `registerAccountWriteTools(server, resolveProject, { includeAdminTools })` so `create_folder` is registered only for admin-capable account sessions.
- Produces: `registerMcpClient`, `authorizeMcpInBrowser`, `exchangeAuthorizationCode`, `mcpRpc`, and `deleteMcpClient`.
- Reuses: PKCE request shapes from `tests/unit/database/mcp-account-scope.behavior.test.ts`.

- [ ] **Step 1: Write failing role-aware discovery tests**

Add Deno assertions that an editor-only account lists ordinary writes such as `add_table_field` but omits `create_folder`; an admin-capable account lists both; direct editor `create_folder` returns tool-not-found; and legacy project editor discovery also omits `create_folder`. Add a migration test proving the new RPC recognizes owned/admin projects, ignores pending collaborators, and is executable only by `authenticated`.

- [ ] **Step 2: Run MCP discovery tests and verify RED**

Run: `deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net supabase/functions/mcp/account-projects.test.ts supabase/functions/mcp/account-tools.test.ts supabase/functions/mcp/server.test.ts`

Expected: FAIL because admin-capable discovery and conditional admin tool registration do not exist.

- [ ] **Step 3: Implement admin-capable discovery**

Create the security-definer boolean RPC, add `accountHasAdminProject`, resolve writable/admin capabilities independently with fail-closed defaults, and pass `includeAdminTools` into the write-tool registry. Keep `create_folder`'s existing target-project role check as defense in depth.

- [ ] **Step 4: Verify discovery GREEN and apply the migration**

Run the Step 2 Deno command and `npx jest --runInBand tests/unit/database/mcp-admin-project-discovery-migration.test.ts`. Then run `supabase migration list`; proceed only when `20260922020000` is the expected newly pending migration, and run `supabase db push --include-all --yes`.

- [ ] **Step 5: Write helper contract tests inside the Playwright spec**

Build one temporary OAuth client with redirect URI `${baseURL}/payment/success`. For each browser-authenticated user, navigate to `/auth/v1/oauth/authorize`, assert the real consent page, click Approve, capture the callback `code`, and exchange it with the original verifier.

- [ ] **Step 6: Implement bounded JSON-RPC transport**

POST with `Authorization: Bearer <token>`, `accept: application/json, text/event-stream`, and monotonically increasing IDs. Parse JSON or the final SSE `data:` payload and throw a redacted error containing only status, method, and stable MCP code.

- [ ] **Step 7: Verify the OAuth helper obtains one token**

Run: `npx playwright test tests/e2e/specs/mcp-authorization.spec.ts --project=chromium --workers=1 --grep "viewer"`

Expected RED first for request-shape mismatches, then GREEN after the helper follows the deployed metadata/authorize endpoints.

---

### Task 4: MCP viewer/editor/admin role matrix

**Files:**
- Create: `tests/e2e/specs/mcp-authorization.spec.ts`
- Modify: `tests/e2e/utils/supabase-admin.ts`

**Interfaces:**
- Adds a fixture helper that creates one owner project, one table, and viewer/editor/admin collaborators.
- Consumes the Task 3 OAuth and JSON-RPC helpers.

- [ ] **Step 1: Write the three role scenarios**

All roles call `initialize`, `tools/list`, and `list_project_structure`. Viewer must not list `create_table`, `add_table_field`, or `create_folder`, and a direct `create_table` call must fail without a row mutation. Editor must list and successfully call `add_table_field`, must not list `create_folder`, and a direct `create_folder` call must return tool-not-found. Admin must list and successfully call `create_folder`.

- [ ] **Step 2: Run and verify RED**

Run: `npx playwright test tests/e2e/specs/mcp-authorization.spec.ts --project=chromium --workers=1`

Expected: failures identify exact OAuth, tool-discovery, or role-call mismatches without exposing tokens.

- [ ] **Step 3: Complete fixture setup and cleanup**

Create the table through the service fixture before tests, assert editor field creation and admin folder creation through service-role reads, revoke all grants, delete the OAuth client, remove the project, and delete users.

- [ ] **Step 4: Verify twice and run static checks**

```bash
npx playwright test tests/e2e/specs/mcp-authorization.spec.ts --project=chromium --workers=1
npx playwright test tests/e2e/specs/mcp-authorization.spec.ts --project=chromium --workers=1
npx eslint tests/e2e/helpers/mcp-oauth.ts tests/e2e/helpers/mcp-jsonrpc.ts tests/e2e/specs/mcp-authorization.spec.ts
npx tsc --noEmit --pretty false
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260922020000_mcp_admin_project_discovery.sql supabase/functions/mcp/account-projects.ts supabase/functions/mcp/account-tools.ts supabase/functions/mcp/write-tools.ts supabase/functions/mcp/account-projects.test.ts supabase/functions/mcp/account-tools.test.ts supabase/functions/mcp/server.test.ts tests/unit/database/mcp-admin-project-discovery-migration.test.ts tests/e2e/helpers/mcp-oauth.ts tests/e2e/helpers/mcp-jsonrpc.ts tests/e2e/specs/mcp-authorization.spec.ts tests/e2e/utils/supabase-admin.ts
git commit -m "test: verify MCP OAuth role permissions"
```
