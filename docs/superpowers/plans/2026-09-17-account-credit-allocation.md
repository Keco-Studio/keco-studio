# Account Credit Allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a 100,000,000 Credit allocation for `KECO_ADMIN_USER_ID`, show allocated/used/remaining Credits on Account, and show live consumed Credit data in Keco Admin with database-verifiable totals.

**Architecture:** Add a private append-only Credit ledger beside `ai_usage_events`, then expose an authenticated own-account RPC and a service-role Admin aggregate RPC. Server services strictly validate both contracts; browser components read authenticated no-store APIs. A separate idempotent operator script applies the initial allocation after migrations pass.

**Tech Stack:** PostgreSQL/Supabase migrations and RLS, Next.js App Router, TypeScript, React Query, Jest/Testing Library, Supabase JS, CSS Modules.

**Spec:** `docs/superpowers/specs/2026-09-15-account-credit-allocation-design.md`

## Global Constraints

- `100000000` is an initial database allocation, never frontend account state.
- Remaining is `max(allocated - used, 0)`; overage is `max(used - allocated, 0)`.
- Consumed Credits use aggregate-first DeepSeek rule v1: `ceil(sum(total_tokens) / 3)`.
- PixelLab and other provider events consume no Credits without a pricing rule.
- Identity joins use immutable Supabase Auth UUIDs, never email addresses.
- Raw ledger and usage tables remain inaccessible to browser roles.
- This release displays accounting data but does not enforce quota.
- Storage stays out of scope and remains disconnected in Admin.
- Preserve uncommitted Billing and Admin authorization work in the main checkout.
- Do not make paid PixelLab calls during verification.

---

### Task 1: Credit Ledger and Summary RPCs

**Files:**
- Create: `supabase/migrations/20260917200000_account_credit_ledger.sql`
- Create: `tests/unit/database/account-credit-ledger-migration.test.ts`
- Create: `tests/unit/database/account-credit-ledger.behavior.test.ts`

**Interfaces:**
- Consumes: `public.ai_usage_events`, `public.ai_usage_tracking_epochs`, pricing rule version `1`.
- Produces: private `public.credit_ledger_entries`, authenticated `public.account_credit_summary()`, and service-role-only `public.keco_admin_credit_summary()`.

- [ ] **Step 1: Write the failing migration contract test**

Assert the new SQL defines the exact ledger and permission boundaries:

```ts
expect(sql).toMatch(/create table public\.credit_ledger_entries/i);
expect(sql).toMatch(/credit_delta\s+bigint\s+not null/i);
expect(sql).toMatch(/reference_key\s+text\s+not null\s+unique/i);
expect(sql).toMatch(/alter table public\.credit_ledger_entries enable row level security/i);
expect(sql).toMatch(/revoke all on table public\.credit_ledger_entries from public, anon, authenticated/i);
expect(sql).toMatch(/grant select, insert on table public\.credit_ledger_entries to service_role/i);
expect(sql).toMatch(/function public\.account_credit_summary\(\)/i);
expect(sql).toMatch(/function public\.keco_admin_credit_summary\(\)/i);
expect(sql).toMatch(/sum\([\s\S]*total_tokens[\s\S]*\+ 2[\s\S]*\/ 3/i);
```

- [ ] **Step 2: Write failing real Postgres behavior tests**

Reuse `tests/unit/database/helpers/rlsTestClient.ts` and the existing `psql` fallback. Insert grants using the service-role fixture and usage through `record_ai_usage_event`.

```ts
expect(await ownSummary(fx.owner.client)).toEqual(expect.objectContaining({
  allocated: 100_000_000,
  used: 7,
  remaining: 99_999_993,
  overage: 0,
  deepseekTokens: 21,
  incompleteCount: 1,
}));
```

Cover aggregate-first rounding of token rows `10 + 11 = 7 Credits`, exclusion of Minimax/embeddings/PixelLab, unknown DeepSeek counts, exhausted balances, positive grants plus negative corrections, duplicate reference rejection, negative-net allocation failure, own-user isolation, unauthenticated denial, authenticated Admin-RPC denial, and ledger table denial for authenticated clients.

- [ ] **Step 3: Run the tests and verify RED**

```bash
npx jest --runInBand \
  tests/unit/database/account-credit-ledger-migration.test.ts \
  tests/unit/database/account-credit-ledger.behavior.test.ts
```

Expected: FAIL because the migration and RPCs do not exist.

- [ ] **Step 4: Implement the ledger and summaries**

Create this table:

```sql
create table public.credit_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  credit_delta bigint not null check (credit_delta <> 0),
  reason text not null check (char_length(reason) between 1 and 256),
  reference_key text not null unique check (char_length(reference_key) between 1 and 160),
  created_at timestamptz not null default clock_timestamp()
);
```

Enable RLS, revoke all browser access, grant only `SELECT, INSERT` to `service_role`, and create no update/delete grants.

`account_credit_summary()` must be `SECURITY DEFINER`, bind the user internally using `auth.uid()`, accept no UUID parameter, aggregate rule-v1 tokens once, count unknown DeepSeek chat attempts, and fail if net allocation is negative.

`keco_admin_credit_summary()` must be service-role-only and return account totals plus a UUID-keyed `users` map. Every account/user object contains `allocated`, `used`, `remaining`, `overage`, `deepseekTokens`, and `incompleteCount`; the root also contains `trackedFrom`. Union IDs present in either grants or usage, and fail if any allocation sum is negative.

Use `SET search_path = ''`, schema-qualified identifiers, explicit function revokes, exact grants, and `NOTIFY pgrst, 'reload schema'`.

- [ ] **Step 5: Apply locally and verify GREEN**

```bash
npx supabase migration up
npm run test:account-credit-db
```

Expected: all contract and real Postgres tests pass.

- [ ] **Step 6: Commit the database contract**

```bash
git add supabase/migrations/20260917200000_account_credit_ledger.sql \
  tests/unit/database/account-credit-ledger-migration.test.ts \
  tests/unit/database/account-credit-ledger.behavior.test.ts
git commit -m "feat: add account credit allocation ledger"
```

---

### Task 2: Account Credit API

**Files:**
- Create: `src/lib/types/accountCredits.ts`
- Create: `src/lib/server/accountCredits.ts`
- Create: `src/app/api/account/credits/route.ts`
- Create: `tests/unit/account/account-credits-service.test.ts`
- Create: `tests/unit/account/account-credits-route.test.ts`

**Interfaces:**
- Consumes: authenticated `client.rpc('account_credit_summary')`.
- Produces: `AccountCreditSummary`, `readOwnAccountCredits(client)`, and `GET /api/account/credits`.

- [ ] **Step 1: Write failing parser and route tests**

Define the contract:

```ts
export type AccountCreditSummary = {
  allocated: number;
  used: number;
  remaining: number;
  overage: number;
  deepseekTokens: number;
  incompleteCount: number;
  trackedFrom: string;
};
```

Accept the exact shape. Reject negative, fractional, unsafe-integer, missing, malformed-timestamp, RPC-error, and null-data responses. Route tests assert authenticated `200`, unauthenticated `401`, RPC failure `503`, and `Cache-Control: private, no-store` on every response. The generic failure body is `{ error: 'Unable to load account Credits' }`.

- [ ] **Step 2: Run tests and verify RED**

```bash
npx jest --runInBand tests/unit/account/account-credits-service.test.ts \
  tests/unit/account/account-credits-route.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement strict parsing and route authentication**

Use one non-negative safe-integer helper:

```ts
function readCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Invalid account Credit field: ${field}`);
  }
  return Number(value);
}
```

Validate `trackedFrom` with `Date.parse`; call the RPC without a user parameter. Wrap the route with `withAuth`, pass the signed-in Supabase client, and return private no-store headers.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
npx jest --runInBand tests/unit/account/account-credits-service.test.ts \
  tests/unit/account/account-credits-route.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit the Account API**

```bash
git add src/lib/types/accountCredits.ts src/lib/server/accountCredits.ts \
  src/app/api/account/credits/route.ts tests/unit/account
git commit -m "feat: expose authenticated account Credits"
```

---

### Task 3: Account Credit UI

**Files:**
- Create: `src/components/account/AccountCreditsSection.tsx`
- Create: `src/components/account/AccountCreditsSection.module.css`
- Modify: `src/components/account/AccountEmailSettings.tsx`
- Modify: `src/components/account/AccountEmailSettings.module.css`
- Modify: `src/app/(dashboard)/account/page.tsx`
- Create: `tests/unit/account/account-credits-section.test.tsx`
- Modify: `tests/unit/auth/account-email-settings.test.tsx`

**Interfaces:**
- Consumes: `GET /api/account/credits` and `AccountCreditSummary`.
- Produces: one Account header, a live Credits section, and the preserved email section.

- [ ] **Step 1: Write failing component tests**

Mock `fetch` and assert:

```ts
expect(screen.getByTestId('account-credits-allocated').textContent).toBe('100,000,000');
expect(screen.getByTestId('account-credits-used').textContent).toBe('7');
expect(screen.getByTestId('account-credits-remaining').textContent).toBe('99,999,993');
```

Also cover fixed loading dimensions, incomplete usage, overage/exhausted status, first-load failure without fake zeroes, and Retry. Preserve every current email-change test after extracting the outer layout.

- [ ] **Step 2: Run tests and verify RED**

```bash
npx jest --runInBand tests/unit/account/account-credits-section.test.tsx \
  tests/unit/auth/account-email-settings.test.tsx
```

Expected: FAIL because the Credits section does not exist.

- [ ] **Step 3: Implement the Account composition**

Move only the outer `<main>`, content wrapper, and page header from `AccountEmailSettings` to the route page. Keep `AccountEmailSettings` responsible for its current `<section>` and behavior.

Fetch with React Query:

```ts
useQuery({
  queryKey: ['account-credits'],
  queryFn: fetchAccountCredits,
  retry: false,
});
```

Format Credits with `toLocaleString('en-US')`. Render Allocated, Used, Remaining in a stable three-column definition list that stacks on mobile. Match existing Account spacing and radii, use no nested cards, show accessible warning/error text, and keep the email workflow below.

- [ ] **Step 4: Run UI tests and lint**

```bash
npx jest --runInBand tests/unit/account/account-credits-section.test.tsx \
  tests/unit/auth/account-email-settings.test.tsx
npx eslint src/components/account/AccountCreditsSection.tsx \
  src/components/account/AccountEmailSettings.tsx \
  'src/app/(dashboard)/account/page.tsx'
```

Expected: tests and lint pass.

- [ ] **Step 5: Commit the Account UI**

```bash
git add src/components/account 'src/app/(dashboard)/account/page.tsx' \
  tests/unit/account/account-credits-section.test.tsx \
  tests/unit/auth/account-email-settings.test.tsx
git commit -m "feat: show Credit balance on Account"
```

---

### Task 4: Keco Admin Credit Data

**Files:**
- Create: `src/lib/server/kecoAdminCredits.ts`
- Modify: `src/lib/server/kecoAdminOverview.ts`
- Modify: `src/lib/types/kecoAdmin.ts`
- Modify: `src/components/keco-admin/KecoAdminDashboard.tsx`
- Modify: `src/components/keco-admin/KecoAdminDashboard.module.css`
- Modify: `tests/unit/keco-admin/keco-admin-overview.test.ts`
- Modify: `tests/unit/keco-admin/keco-admin-overview-route.test.ts`
- Modify: `tests/unit/keco-admin/keco-admin-dashboard.test.tsx`
- Modify: `tests/unit/keco-admin/keco-admin-wiring.test.ts`

**Interfaces:**
- Consumes: service-role `client.rpc('keco_admin_credit_summary')` and Auth Admin pagination.
- Produces: `readKecoAdminCredits(client)` and Credit fields in `KecoAdminOverview`.

- [ ] **Step 1: Extend failing Admin tests**

Add this root contract:

```ts
creditUsage: {
  allocated: 100_000_000,
  used: 7,
  remaining: 99_999_993,
  overage: 0,
  deepseekTokens: 21,
  incompleteCount: 1,
  trackedFrom: '2026-09-15T00:00:00.000Z',
}
```

Each user gets `creditAllocated`, `creditUsed`, `creditRemaining`,
`creditOverage`, `deepseekTokens`, and `creditUsageIncompleteCount`. Test
strict parser rejection, concurrent Auth/Credit reads, UUID joins, and valid
zeroes for missing user-map entries.

Dashboard tests find `7` used, `100,000,000 allocated`, `99,999,993 remaining`, matching per-user values, incomplete and exhausted states, stable skeletons, and last successful values after refresh failure. Storage stays unavailable.

- [ ] **Step 2: Run Admin tests and verify RED**

```bash
npx jest --runInBand tests/unit/keco-admin
```

Expected: FAIL because Credit is currently disconnected.

- [ ] **Step 3: Implement parser and overview join**

Strictly validate non-negative safe integers, timestamp, root object, and UUID-keyed user objects. Start reads concurrently:

```ts
const [authResult, credits] = await Promise.all([
  client.auth.admin.listUsers({ page: 1, perPage: USERS_PER_PAGE }),
  readKecoAdminCredits(client),
]);
```

Join by `user.id`; use a constant zero Credit object when a known Auth user is absent from the map. Preserve suspended status and generic route failure behavior. Do not change Admin authorization.

- [ ] **Step 4: Replace only Credit placeholders**

Render Total users, live Credit usage, and unavailable Storage in the current three-column metrics grid. The Credit panel emphasizes used, with allocated and remaining secondary values. The table cell shows Used and Remaining on distinct lines with tabular numerals. Add a visible warning/tooltip for incomplete usage and Exhausted only when overage is positive. Keep plan filters, Storage, and actions unchanged.

- [ ] **Step 5: Run Admin tests and lint**

```bash
npx jest --runInBand tests/unit/keco-admin
npx eslint src/lib/server/kecoAdminCredits.ts src/lib/server/kecoAdminOverview.ts \
  src/lib/types/kecoAdmin.ts src/components/keco-admin/KecoAdminDashboard.tsx
```

Expected: all tests and lint pass.

- [ ] **Step 6: Commit Admin Credit integration**

Inspect authorization diffs before staging, then stage only Credit files:

```bash
git diff -- src/app/api/keco-admin src/lib/server/kecoAdminAuthorization.ts
git add src/lib/server/kecoAdminCredits.ts src/lib/server/kecoAdminOverview.ts \
  src/lib/types/kecoAdmin.ts src/components/keco-admin tests/unit/keco-admin
git commit -m "feat: show Credit usage in Keco Admin"
```

---

### Task 5: Idempotent Initial Allocation Command

**Files:**
- Create: `scripts/grant-account-credits.ts`
- Create: `tests/unit/scripts/grant-account-credits.test.ts`
- Modify: `package.json`
- Modify: `scripts/README.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `KECO_ADMIN_USER_ID`, and the Credit ledger.
- Produces: `npm run grant:account-credits -- --amount 100000000 --reference initial-admin-allocation-2026-09-17 --reason "Initial account allocation"`.

- [ ] **Step 1: Write failing operator tests**

Extract pure argument/environment parsing and injectable `grantAccountCredits(client, input)`. Assert positive-safe-integer rules:

```ts
expect(parsePositiveSafeInteger('100000000')).toBe(100_000_000);
expect(() => parsePositiveSafeInteger('0')).toThrow();
expect(() => parsePositiveSafeInteger('-1')).toThrow();
expect(() => parsePositiveSafeInteger('1.5')).toThrow();
```

Mock Supabase so the function confirms `auth.admin.getUserById`, treats an identical existing reference as success without inserting, rejects mismatched reference reuse, inserts one missing entry, and never prints credentials.

- [ ] **Step 2: Run tests and verify RED**

```bash
npx jest --runInBand tests/unit/scripts/grant-account-credits.test.ts
```

Expected: FAIL because the operator module does not exist.

- [ ] **Step 3: Implement command and documentation**

Load `.env.local` without override. Require all three environment variables and explicit `--amount`, `--reference`, `--reason`. Validate the Auth UUID, query the unique reference before insertion, and re-read it after insertion. An identical row is idempotent success; mismatched reuse fails.

Add `"grant:account-credits": "tsx scripts/grant-account-credits.ts"` to package scripts. Document the exact command and its remote mutation. Add safe variable names to `.env.example` without values.

- [ ] **Step 4: Run tests and non-mutating help**

```bash
npx jest --runInBand tests/unit/scripts/grant-account-credits.test.ts
npx tsx scripts/grant-account-credits.ts --help
```

Expected: tests pass and help exits zero without connecting.

- [ ] **Step 5: Commit operator tooling**

```bash
git add scripts/grant-account-credits.ts tests/unit/scripts/grant-account-credits.test.ts \
  package.json scripts/README.md .env.example
git commit -m "feat: add idempotent Credit allocation command"
```

---

### Task 6: Verification and Database Application

**Files:**
- Modify only when verification exposes a defect in Task 1-5 files.

**Interfaces:**
- Consumes: all prior tasks and configured Supabase environment.
- Produces: applied schema, one idempotent `100000000` allocation, working pages, and SQL verification evidence.

- [ ] **Step 1: Run focused automated verification**

```bash
npx jest --runInBand tests/unit/database/account-credit-ledger-migration.test.ts \
  tests/unit/account tests/unit/auth/account-email-settings.test.tsx \
  tests/unit/keco-admin tests/unit/scripts/grant-account-credits.test.ts \
  tests/unit/payment/payment-domain.test.ts tests/unit/ai-usage
npm run typecheck
npm run typecheck:api
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 2: Run local database verification**

```bash
npx supabase migration up
npm run test:account-credit-db
```

Expected: real Postgres behavior tests pass.

- [ ] **Step 3: Preflight remote migrations**

```bash
npx supabase migration list
```

Proceed only if pending remote migrations are the reviewed AI usage and Credit migrations required by this branch. If unrelated versions appear, do not push; report them and coordinate release order.

- [ ] **Step 4: Apply migrations and allocate Credits**

```bash
npx supabase db push
npm run grant:account-credits -- \
  --amount 100000000 \
  --reference initial-admin-allocation-2026-09-17 \
  --reason "Initial account allocation"
```

Run the allocation command twice. The second run must report an existing identical allocation without changing ledger count.

- [ ] **Step 5: Verify with read-only SQL**

In Supabase SQL Editor, replace only the UUID constant with `KECO_ADMIN_USER_ID`:

```sql
with params as (
  select '00000000-0000-0000-0000-000000000000'::uuid as user_id
), allocation as (
  select coalesce(sum(e.credit_delta), 0)::bigint as allocated
  from public.credit_ledger_entries e cross join params p
  where e.user_id = p.user_id
), usage as (
  select
    coalesce(sum(e.total_tokens) filter (where e.pricing_rule_version = 1), 0)::bigint as tokens,
    count(*) filter (where e.provider = 'deepseek' and e.request_kind = 'chat_completion'
      and e.usage_status = 'unknown')::bigint as incomplete
  from public.ai_usage_events e cross join params p
  where e.user_id = p.user_id
), totals as (
  select allocation.allocated,
    case when usage.tokens = 0 then 0 else (usage.tokens + 2) / 3 end as used,
    usage.tokens, usage.incomplete
  from allocation cross join usage
)
select allocated, used,
  greatest(allocated - used, 0) as remaining,
  greatest(used - allocated, 0) as overage,
  tokens as deepseek_tokens, incomplete as incomplete_count
from totals;
```

Expected: `allocated = 100000000`; used and remaining match both pages.

- [ ] **Step 6: Start and inspect the application**

```bash
npm run dev -- --port 3001
```

Sign in as `KECO_ADMIN_USER_ID`. Verify `/account` shows Allocated `100,000,000` and real Used/Remaining; `/keco-admin` shows the same user's consumption and remaining balance; refresh preserves values; Storage remains disconnected; no PixelLab operation runs.

- [ ] **Step 7: Run final validation**

```bash
npm run validate
git status --short
git log -8 --oneline
```

Expected: validation exits zero and there are no unexpected modifications. Report any unrelated pre-existing validation failure with its exact command/output while preserving focused green evidence.
