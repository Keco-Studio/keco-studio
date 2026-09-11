# Keco Admin User Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an administrator-only Keco workspace with a live Supabase Auth user count and complete unavailable-state UI for future Credit, Stay, Storage, and user-detail data.

**Architecture:** A server-only UUID allowlist helper gates both a small navigation-capability endpoint and the overview endpoint. The overview endpoint creates the service-role client only after authorization and returns only `{ totalUsers, refreshedAt }`; a shared React Query capability hook controls both navigation surfaces, while the dashboard uses Keco's existing TopBar and LeftNav shell.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Supabase Auth Admin, TanStack Query, Ant Design icons, CSS Modules, Jest, React DOM server rendering, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-11-keco-admin-user-overview-design.md`

## Global Constraints

- Runtime authorization uses only the server-side `KECO_ADMIN_USER_ID` value `aae0969f-0cb2-4632-8624-b9f40f2f4543`; do not authorize by email or expose this configuration in a `NEXT_PUBLIC_*` variable.
- Missing, whitespace-padded, malformed, or non-matching administrator configuration fails closed.
- The browser must never receive Supabase service-role credentials, user records, email addresses, or Auth metadata.
- `GET /api/keco-admin/access` and `GET /api/keco-admin/overview` must use `Cache-Control: private, no-store` and the shared `withAuth` boundary.
- Only Total users uses real data in this delivery. Credit, Stay, Storage, and user details render complete UI with explicit unavailable states and no fictional values.
- Do not modify registration behavior, profile schema, database migrations, or account-uniqueness constraints.
- Reuse Keco's Roboto/Nunito typography, `#0b99ff` token, neutral surfaces, existing shell, and enabled Ant Design icon library. Do not copy code or sample data from `/home/ltt/project/index.html`.
- Keep cards at 8px radius or less, keep font sizes independent of viewport width, preserve visible focus, and respect reduced motion.

---

### Task 1: Server-only administrator authorization and capability API

**Files:**
- Create: `src/lib/server/kecoAdminAuthorization.ts`
- Create: `src/app/api/keco-admin/access/route.ts`
- Create: `tests/unit/keco-admin/keco-admin-authorization.test.ts`
- Create: `tests/unit/keco-admin/keco-admin-access-route.test.ts`
- Modify: `.env.example`
- Modify locally but do not commit: `.env.local`

**Interfaces:**
- Consumes: authenticated `user.id` from `withAuth`; server variable `KECO_ADMIN_USER_ID`.
- Produces: `isKecoAdminUser(userId: string, configuredId?: string): boolean` and authenticated `GET /api/keco-admin/access -> { isAdmin: boolean }`.

- [ ] **Step 1: Write the failing authorization-helper test**

```ts
jest.mock('server-only', () => ({}));

import { isKecoAdminUser } from '@/lib/server/kecoAdminAuthorization';

const ADMIN_ID = 'aae0969f-0cb2-4632-8624-b9f40f2f4543';

describe('Keco Admin authorization', () => {
  it('allows only an exact configured UUID match', () => {
    expect(isKecoAdminUser(ADMIN_ID, ADMIN_ID)).toBe(true);
    expect(isKecoAdminUser('11111111-1111-4111-8111-111111111111', ADMIN_ID)).toBe(false);
  });

  it.each([undefined, '', ` ${ADMIN_ID}`, `${ADMIN_ID} `, 'not-a-uuid'])
    ('fails closed for invalid configuration %p', (configuredId) => {
      expect(isKecoAdminUser(ADMIN_ID, configuredId)).toBe(false);
    });
});
```

- [ ] **Step 2: Run the helper test and verify RED**

Run: `npm run test:unit -- --runInBand tests/unit/keco-admin/keco-admin-authorization.test.ts`

Expected: FAIL because `kecoAdminAuthorization.ts` does not exist.

- [ ] **Step 3: Implement the minimal server-only helper**

```ts
import 'server-only';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isKecoAdminUser(
  userId: string,
  configuredId: string | undefined = process.env.KECO_ADMIN_USER_ID,
): boolean {
  return Boolean(configuredId && UUID.test(configuredId) && userId === configuredId);
}
```

- [ ] **Step 4: Run the helper test and verify GREEN**

Run: `npm run test:unit -- --runInBand tests/unit/keco-admin/keco-admin-authorization.test.ts`

Expected: PASS.

- [ ] **Step 5: Write the failing capability-route tests**

Mock `withAuth` using the established `mcp-connections-route.test.ts` pattern, set the authenticated test user ID per case, import `GET`, and assert:

```ts
expect((await GET(request, undefined)).status).toBe(401);
expect(await adminResponse.json()).toEqual({ isAdmin: true });
expect(await otherResponse.json()).toEqual({ isAdmin: false });
expect(adminResponse.headers.get('cache-control')).toBe('private, no-store');
```

Set `process.env.KECO_ADMIN_USER_ID` in `beforeEach`, restore the original value in `afterAll`, and include a missing-config case that returns `{ isAdmin: false }`.

- [ ] **Step 6: Run the route test and verify RED**

Run: `npm run test:unit -- --runInBand tests/unit/keco-admin/keco-admin-access-route.test.ts`

Expected: FAIL because the access route does not exist.

- [ ] **Step 7: Implement the authenticated capability route and document configuration**

```ts
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

export const GET = withAuth(async function GET(_request, _context, { user }) {
  return NextResponse.json(
    { isAdmin: isKecoAdminUser(user.id) },
    { headers: NO_STORE_HEADERS },
  );
}, {
  unauthorizedResponse: () => NextResponse.json(
    { error: 'Please sign in to continue' },
    { status: 401, headers: NO_STORE_HEADERS },
  ),
});
```

Append this documented server variable to `.env.example` without a live value:

```dotenv
# Supabase Auth UUID allowed to open the account-level Keco Admin workspace.
KECO_ADMIN_USER_ID=
```

Add the approved UUID to the ignored `.env.local` so the local application is
usable, and verify the file remains ignored:

```dotenv
KECO_ADMIN_USER_ID=aae0969f-0cb2-4632-8624-b9f40f2f4543
```

Run: `git check-ignore .env.local`

Expected: `.env.local`.

- [ ] **Step 8: Run Task 1 tests and commit**

Run: `npm run test:unit -- --runInBand tests/unit/keco-admin/keco-admin-authorization.test.ts tests/unit/keco-admin/keco-admin-access-route.test.ts tests/unit/auth/api-auth-static.test.ts`

Expected: PASS.

```bash
git add .env.example src/lib/server/kecoAdminAuthorization.ts src/app/api/keco-admin/access/route.ts tests/unit/keco-admin
git commit -m "feat: add Keco Admin access boundary"
```

### Task 2: Authoritative user-count service and overview API

**Files:**
- Create: `src/lib/server/kecoAdminOverview.ts`
- Create: `src/app/api/keco-admin/overview/route.ts`
- Create: `tests/unit/keco-admin/keco-admin-overview.test.ts`
- Create: `tests/unit/keco-admin/keco-admin-overview-route.test.ts`

**Interfaces:**
- Consumes: `isKecoAdminUser`, `getSupabaseServiceRoleClient`, and Supabase Auth Admin `listUsers({ page: 1, perPage: 1 })`.
- Produces: `KecoAdminOverview = { totalUsers: number; refreshedAt: string }`, `readKecoAdminOverview(client, now?)`, and administrator-only `GET /api/keco-admin/overview`.

- [ ] **Step 1: Write the failing overview-service tests**

```ts
const listUsers = jest.fn(async () => ({ data: { users: [], total: 9 }, error: null }));
const client = { auth: { admin: { listUsers } } } as never;

await expect(readKecoAdminOverview(client, () => new Date('2026-09-11T10:00:00.000Z')))
  .resolves.toEqual({ totalUsers: 9, refreshedAt: '2026-09-11T10:00:00.000Z' });
expect(listUsers).toHaveBeenCalledWith({ page: 1, perPage: 1 });
```

Add separate cases for an Auth Admin error and for an invalid negative/fractional/missing `total`; each must reject without returning user records.

- [ ] **Step 2: Run the service test and verify RED**

Run: `npm run test:unit -- --runInBand tests/unit/keco-admin/keco-admin-overview.test.ts`

Expected: FAIL because `kecoAdminOverview.ts` does not exist.

- [ ] **Step 3: Implement the count service**

```ts
export type KecoAdminOverview = { totalUsers: number; refreshedAt: string };

export async function readKecoAdminOverview(
  client: SupabaseClient,
  now: () => Date = () => new Date(),
): Promise<KecoAdminOverview> {
  const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) throw new Error('Unable to read the account total');
  if (!Number.isInteger(data.total) || data.total < 0) {
    throw new Error('Supabase returned an invalid account total');
  }
  return { totalUsers: data.total, refreshedAt: now().toISOString() };
}
```

- [ ] **Step 4: Run the service test and verify GREEN**

Run: `npm run test:unit -- --runInBand tests/unit/keco-admin/keco-admin-overview.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing overview-route tests**

Use the route-auth mock pattern from Task 1. Mock `getSupabaseServiceRoleClient` and `readKecoAdminOverview`, then prove:

```ts
expect(unauthenticated.status).toBe(401);
expect(nonAdmin.status).toBe(403);
expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
expect(readKecoAdminOverview).not.toHaveBeenCalled();
expect(await admin.json()).toEqual({ totalUsers: 9, refreshedAt: '2026-09-11T10:00:00.000Z' });
expect(admin.headers.get('cache-control')).toBe('private, no-store');
```

Add a service failure assertion for status `503`, the generic body
`{ error: 'Unable to load Keco Admin data' }`, and a log that does not contain
the thrown private error text.

- [ ] **Step 6: Run the route test and verify RED**

Run: `npm run test:unit -- --runInBand tests/unit/keco-admin/keco-admin-overview-route.test.ts`

Expected: FAIL because the overview route does not exist.

- [ ] **Step 7: Implement the overview route with post-auth service construction**

```ts
export const GET = withAuth(async function GET(_request, _context, { user }) {
  if (!isKecoAdminUser(user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS });
  }
  try {
    const overview = await readKecoAdminOverview(getSupabaseServiceRoleClient());
    return NextResponse.json(overview, { headers: NO_STORE_HEADERS });
  } catch {
    console.error('[GET /api/keco-admin/overview] Unable to load overview');
    return NextResponse.json(
      { error: 'Unable to load Keco Admin data' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}, {
  unauthorizedResponse: () => NextResponse.json(
    { error: 'Please sign in to continue' },
    { status: 401, headers: NO_STORE_HEADERS },
  ),
});
```

Do not import route state or return provider errors.

- [ ] **Step 8: Run Task 2 tests and commit**

Run: `npm run test:unit -- --runInBand tests/unit/keco-admin/keco-admin-overview.test.ts tests/unit/keco-admin/keco-admin-overview-route.test.ts tests/unit/auth/api-auth-static.test.ts`

Expected: PASS.

```bash
git add src/lib/server/kecoAdminOverview.ts src/app/api/keco-admin/overview/route.ts tests/unit/keco-admin
git commit -m "feat: expose Keco Admin user total"
```

### Task 3: Shared access query and administrator-only navigation

**Files:**
- Create: `src/lib/hooks/useKecoAdminAccess.ts`
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/components/layout/LeftNav.tsx`
- Modify: `src/lib/create-map/productNavigation.ts`
- Modify: `src/lib/utils/routeParams.ts`
- Create: `tests/unit/keco-admin/keco-admin-navigation.test.ts`
- Modify: `tests/unit/layout/leftnav-wiring.test.ts`
- Modify: `tests/unit/keco-101/keco-101-wiring.test.ts`

**Interfaces:**
- Consumes: `GET /api/keco-admin/access`, authenticated `userProfile.id`, and existing product navigation APIs.
- Produces: `useKecoAdminAccess(userId?: string): UseQueryResult<boolean>`, the `kecoAdmin` product-navigation state, and `/keco-admin` entry points.

- [ ] **Step 1: Write failing route and product-navigation assertions**

Add assertions that `/keco-admin` is a root special route with `projectId: null`, that `getProductNavigationState('/keco-admin')` activates only `kecoAdmin`, and that `getProductNavigationDestination('/projects', 'kecoAdmin')` returns `/keco-admin` while the active destination is `null`.

Update every existing exact `ProductNavigationState` expectation to include
`kecoAdmin: false`.

- [ ] **Step 2: Write failing source-level navigation tests**

Create `keco-admin-navigation.test.ts` and assert:

```ts
expect(topBar).toContain('useKecoAdminAccess(userId)');
expect(menu.indexOf('Keco Admin')).toBeLessThan(menu.indexOf('Logout'));
expect(menu.indexOf('Keco Admin')).toBeGreaterThan(menu.indexOf('MCP'));
expect(topBar).toContain("router.push('/keco-admin')");
expect(leftNav).toContain('aria-label="Keco Admin"');
expect(leftNav.indexOf('aria-label="Keco Admin"')).toBeGreaterThan(leftNav.indexOf('aria-label="System"'));
expect(leftNav).toMatch(/isKecoAdmin[\s\S]+aria-label="Keco Admin"/);
```

Also assert the hook uses query key `['keco-admin-access', userId]`, is disabled without a user ID, has `staleTime: Infinity`, does not retry, fetches with `cache: 'no-store'`, and maps every non-OK/error response to `false`.

Mock `useKecoAdminAccess` to `{ data: false }` in existing isolated LeftNav
render tests so those tests keep their six-control non-admin expectation without
requiring a QueryClient provider.

- [ ] **Step 3: Run the navigation tests and verify RED**

Run: `npm run test:unit -- --runInBand tests/unit/keco-admin/keco-admin-navigation.test.ts tests/unit/layout/leftnav-wiring.test.ts tests/unit/keco-101/keco-101-wiring.test.ts`

Expected: FAIL because the admin product state, hook, and controls are absent.

- [ ] **Step 4: Implement the capability hook and product state**

```ts
export function useKecoAdminAccess(userId?: string) {
  return useQuery({
    queryKey: ['keco-admin-access', userId],
    enabled: Boolean(userId),
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      try {
        const response = await fetch('/api/keco-admin/access', { cache: 'no-store' });
        if (!response.ok) return false;
        const body = await response.json() as { isAdmin?: unknown };
        return body.isAdmin === true;
      } catch {
        return false;
      }
    },
  });
}
```

Add `kecoAdmin` to `ProductNavigationItem`; make Studio false on that route;
route its destination to `/keco-admin`; and add `keco-admin` to
`SPECIAL_ROUTE_SEGMENTS`.

- [ ] **Step 5: Implement both conditional navigation entries**

Call the shared hook from TopBar and LeftNav. Render the avatar-menu button only
when `isKecoAdmin === true`, directly between MCP and Logout. Render an
Ant Design `SafetyCertificateOutlined` product item only when authorized,
directly below System, with `aria-current="page"` on the admin route.

- [ ] **Step 6: Run Task 3 tests and commit**

Run: `npm run test:unit -- --runInBand tests/unit/keco-admin/keco-admin-navigation.test.ts tests/unit/layout/leftnav-wiring.test.ts tests/unit/keco-101/keco-101-wiring.test.ts tests/unit/mcp/mcp-account-page.test.ts`

Expected: PASS.

```bash
git add src/lib/hooks/useKecoAdminAccess.ts src/components/layout/TopBar.tsx src/components/layout/LeftNav.tsx src/lib/create-map/productNavigation.ts src/lib/utils/routeParams.ts tests/unit/keco-admin tests/unit/layout/leftnav-wiring.test.ts tests/unit/keco-101/keco-101-wiring.test.ts
git commit -m "feat: add Keco Admin navigation"
```

### Task 4: Keco Admin shell and complete dashboard UI

**Files:**
- Create: `src/app/(dashboard)/keco-admin/page.tsx`
- Create: `src/components/keco-admin/KecoAdminDashboard.tsx`
- Create: `src/components/keco-admin/KecoAdminDashboard.module.css`
- Modify: `src/components/layout/DashboardLayout.tsx`
- Create: `tests/unit/keco-admin/keco-admin-dashboard.test.tsx`
- Create: `tests/unit/keco-admin/keco-admin-wiring.test.ts`

**Interfaces:**
- Consumes: `GET /api/keco-admin/overview -> KecoAdminOverview`, `useAuth().userProfile`, existing TopBar/LeftNav shell.
- Produces: responsive `/keco-admin` workspace with real count refresh and unavailable future-data regions.

- [ ] **Step 1: Write failing dashboard rendering tests**

Use React Testing Library with `/** @jest-environment jsdom */`, mock `fetch`,
`next/navigation`, and Ant icons, wrap the dashboard in a fresh QueryClient, and
assert the successful response renders:

```ts
expect(await screen.findByText('9')).toBeTruthy();
expect(screen.getByRole('heading', { name: 'Keco Admin' })).toBeTruthy();
expect(screen.getByText('Admin only')).toBeTruthy();
expect(screen.getAllByText('Not connected')).toHaveLength(3);
expect(screen.getByRole('table', { name: 'User resource details' })).toBeTruthy();
expect(screen.getByText('User detail data is not connected')).toBeTruthy();
expect(screen.queryByText('2779398949@qq.com')).toBeNull();
```

Add tests for stable loading UI, first-load error with Retry, manual refresh,
and a refresh failure that preserves the prior `9`.

- [ ] **Step 2: Write failing shell and CSS wiring tests**

Assert `/keco-admin` mounts `KecoAdminDashboard`; DashboardLayout shows LeftNav
and TopBar while excluding Studio Sidebar and ChatPanel for this route; CSS has
four/two/one column breakpoints, an overflow container for the table, explicit
focus-visible styles, `border-radius` values no greater than `8px`, and a
`prefers-reduced-motion` rule. Assert it contains no `clamp(`, `min(`, or `max(`
font sizing.

- [ ] **Step 3: Run dashboard tests and verify RED**

Run: `npm run test:unit -- --runInBand tests/unit/keco-admin/keco-admin-dashboard.test.tsx tests/unit/keco-admin/keco-admin-wiring.test.ts`

Expected: FAIL because the route and dashboard do not exist.

- [ ] **Step 4: Implement data loading and access behavior**

Use `useQuery<KecoAdminOverview>` with query key `['keco-admin-overview']`,
`retry: false`, and `cache: 'no-store'`. Validate the response shape in the
query function. On `401` or `403`, call `router.replace('/projects')`. The
Refresh icon button calls `refetch()` and exposes `aria-label="Refresh admin data"`.
Keep `data.totalUsers` rendered during a background refetch error.

- [ ] **Step 5: Implement the complete semantic UI**

Build one `<main>` with:

- compact page header, `Admin only` badge, refreshed timestamp, and refresh icon;
- four metric panels with Ant Design Users, Thunderbolt, Database, and Clock
  icons;
- live count and blue data rail only in Total users;
- em dash and `Not connected` for the other three panels;
- disabled search, All/Starter/Pro/Studio/Enterprise segments, and filter button;
- an accessible table named `User resource details` with User, Plan, Credit,
  Stay, Storage, Status, and Actions columns;
- one full-width unavailable row and disabled pagination controls.

Do not include sample users, sample resource values, report export, quota
adjustment, presence, or active subscription counts.

- [ ] **Step 6: Implement Keco-native responsive styling**

Use `var(--font-roboto)`, `var(--font-nunito)`, `var(--keco-blue)`, white,
`#f8fafc`, `#e2e8f0`, `#64748b`, and semantic green/red only for live/error
states. Use 8px-or-smaller radii. Set four columns by default, two below 980px,
and one below 680px. Keep the table at a stable minimum width inside an
`overflow-x: auto` wrapper. Add focus outlines and suppress non-essential
transitions under reduced motion.

- [ ] **Step 7: Run Task 4 tests and commit**

Run: `npm run test:unit -- --runInBand tests/unit/keco-admin/keco-admin-dashboard.test.tsx tests/unit/keco-admin/keco-admin-wiring.test.ts tests/unit/auth/dashboard-layout-auth-gate.test.ts`

Expected: PASS.

```bash
git add src/app/'(dashboard)'/keco-admin src/components/keco-admin src/components/layout/DashboardLayout.tsx tests/unit/keco-admin
git commit -m "feat: build Keco Admin overview"
```

### Task 5: Integrated verification and browser acceptance

**Files:**
- Create: `tests/e2e/specs/keco-admin.spec.ts`
- Modify only if a discovered regression requires a scoped production or test fix.

**Interfaces:**
- Consumes: completed authorization, APIs, navigation, shell, and dashboard.
- Produces: end-to-end evidence for approved and unapproved accounts plus final repository verification.

- [ ] **Step 1: Write the browser scenarios**

Use existing authenticated-context and Supabase admin helpers. Configure
`KECO_ADMIN_USER_ID` for the approved fixture user, then test:

```ts
await page.getByTestId('user-menu').click();
await expect(page.getByRole('button', { name: 'Keco Admin', exact: true })).toBeVisible();
await page.getByRole('button', { name: 'Keco Admin', exact: true }).click();
await expect(page).toHaveURL('/keco-admin');
await expect(page.getByRole('heading', { name: 'Keco Admin' })).toBeVisible();
await expect(page.getByTestId('keco-admin-total-users')).toHaveText(/\d+/);
```

Open a second authenticated fixture user and assert both navigation entries are
absent and `/api/keco-admin/overview` returns `403`. Skip with an explicit real
Supabase/configuration reason when required credentials are unavailable.

- [ ] **Step 2: Run focused unit and API tests**

Run: `npm run test:unit -- --runInBand tests/unit/keco-admin tests/unit/layout/leftnav-wiring.test.ts tests/unit/keco-101/keco-101-wiring.test.ts tests/unit/mcp/mcp-account-page.test.ts tests/unit/auth/api-auth-static.test.ts tests/unit/auth/dashboard-layout-auth-gate.test.ts`

Expected: PASS with no warnings.

- [ ] **Step 3: Run static verification**

Run: `npm run typecheck && npm run lint && npm run build`

Expected: all commands exit 0. Fix only regressions caused by this feature.

- [ ] **Step 4: Run browser acceptance or record the environment blocker**

Run: `KECO_ADMIN_USER_ID=aae0969f-0cb2-4632-8624-b9f40f2f4543 npm run test:e2e -- tests/e2e/specs/keco-admin.spec.ts --workers=1`

Expected: PASS. If Chromium still cannot start because `libnspr4.so` is absent,
record that exact blocker, run the full non-browser verification, and do not
claim screenshot or browser success.

- [ ] **Step 5: Run responsive visual checks when Chromium is available**

Capture `/keco-admin` at 1440x900, 768x1024, and 390x844. Verify the real count
is visible, controls do not overlap, cards resolve to 4/2/1 columns, the table
scroll region stays inside the viewport, and no sample user identity appears.

- [ ] **Step 6: Review scope and commit acceptance coverage**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~4..HEAD
```

Confirm no registration, Auth schema, profile migration, or unrelated user file
was changed. Keep `.tmp-upload-local-asset.ts` untracked and untouched.

```bash
git add tests/e2e/specs/keco-admin.spec.ts
git commit -m "test: cover Keco Admin access"
```
