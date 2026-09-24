# Billing and OAuth Consent Playwright Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic Playwright coverage for billing checkout, payment result pages, and the OAuth consent security flow.

**Architecture:** Exercise the real Next.js pages and authenticated browser session. Stub only the Stripe checkout endpoint and Supabase OAuth/resource endpoints at Playwright's browser network boundary, recording requests so assertions cover UI state, payloads, revalidation, and navigation.

**Tech Stack:** Playwright, TypeScript, Next.js, Supabase Auth/PostgREST browser client.

## Global Constraints

- Do not call real Stripe Checkout or an external OAuth provider.
- Use a temporary Supabase user and authenticate through the real login UI.
- Use same-origin callback URLs so navigation is observable.
- Do not modify production code or component interfaces.
- Use locator state and response promises; do not add fixed-duration waits.
- Preserve the existing unit tests for exhaustive OAuth race permutations.

---

### Task 1: Billing browser coverage

**Files:**
- Create: `tests/e2e/specs/billing.spec.ts`

**Interfaces:**
- Consumes: `createTemporaryUser`, `deleteTemporaryUser`, `getE2EAdminClient`, `gotoAuth`, and `loginWithCredentials` from the existing E2E utilities.
- Produces: Browser coverage for `/billing`, `POST /api/checkout`, `/payment/success`, and `/payment/cancel`.

- [x] **Step 1: Write the billing spec**

Create a serial suite with one temporary user. Add a local `login(page)` helper that signs in through `/`, waits for `/projects`, waits for `data-testid="user-menu"`, and waits for its guest fallback image to disappear so the profile email is available to checkout.

Add these tests:

```ts
test('opens Billing from the avatar menu and renders the selectable catalog', async ({ page }) => {
  await login(page);
  await page.getByTestId('user-menu').click();
  await page.getByTestId('user-menu-billing').click();
  await expect(page).toHaveURL(/\/billing$/);
  await expect(page.getByRole('region', { name: 'Subscription plans' })).toBeVisible();
  for (const plan of ['Starter', 'Pro', 'Studio', 'Enterprise']) {
    await expect(page.getByRole('heading', { name: plan, exact: true })).toBeVisible();
  }
  const studio = page.getByTestId('billing-plan-plan-studio');
  await studio.click();
  await expect(studio).toHaveAttribute('aria-pressed', 'true');
  await expect(studio).toHaveAttribute('data-selected', 'true');
});
```

```ts
test('submits Pro checkout, locks every action, and returns from success', async ({ page }) => {
  let releaseCheckout!: () => void;
  const checkoutRequest = new Promise<Record<string, unknown>>((resolveRequest) => {
    void page.route('**/api/checkout', async (route) => {
      expect(route.request().method()).toBe('POST');
      const body = route.request().postDataJSON() as Record<string, unknown>;
      releaseCheckout = () => void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: `${appOrigin()}/payment/success?session_id=e2e` }),
      });
      resolveRequest(body);
    });
  });
  await login(page);
  await page.goto('/billing');
  await page.getByRole('button', { name: 'Choose Pro' }).click();
  await expect(checkoutRequest).resolves.toEqual({ planId: 'plan-pro', customerEmail: user.email });
  await expect(page.getByRole('button', { name: 'Opening checkout...' })).toBeDisabled();
  const actions = page.locator('[data-testid^="billing-plan-"] button');
  await expect(actions).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) await expect(actions.nth(index)).toBeDisabled();
  releaseCheckout();
  await expect(page).toHaveURL(/\/payment\/success\?session_id=e2e$/);
  await expect(page.getByRole('heading', { name: 'Thank you for your payment.' })).toBeVisible();
  await page.getByRole('link', { name: 'Return to billing' }).click();
  await expect(page).toHaveURL(/\/billing$/);
});
```

Add a failure test where `/api/checkout` returns status `503` and `{"error":"Checkout temporarily unavailable"}`. Assert the `role=status` toast contains that text, `Opening checkout...` disappears, and all four plan buttons are enabled again. Add a cancel-page test that opens `/payment/cancel`, asserts `No payment was taken.`, clicks `Return to billing`, and reaches `/billing`.

- [x] **Step 2: Run the billing spec to verify the new coverage is active**

Run:

```bash
npx playwright test tests/e2e/specs/billing.spec.ts --project=chromium --workers=1
```

Expected RED checkpoint: the newly added tests are discovered and fail if a selector, request contract, busy state, error recovery, or navigation assumption is wrong. Correct test setup errors until failures represent an unmet browser assertion, without changing production code.

- [x] **Step 3: Complete the network fixture and selectors**

Keep route matching limited to `**/api/checkout`. Validate request method and body inside the handler, fulfill JSON with `contentType: 'application/json'`, and use `appOrigin()` derived from `PLAYWRIGHT_PORT ?? '3000'`. Use role/test-id selectors from the rendered production UI; do not add test-only production attributes.

- [x] **Step 4: Run the billing spec to verify GREEN**

Run the Step 2 command again.

Expected: all billing tests pass with one worker and no real Stripe navigation.

---

### Task 2: OAuth consent browser coverage

**Files:**
- Create: `tests/e2e/specs/oauth-consent.spec.ts`

**Interfaces:**
- Consumes: the same temporary-user/login utilities as Task 1 and the configured `NEXT_PUBLIC_SUPABASE_URL` origin.
- Produces: A browser OAuth backend fixture that handles authorization details, resource RPC, and consent decisions while recording calls.

- [x] **Step 1: Write the OAuth backend fixture and account approval test**

Define complete OAuth details and a fixture with these endpoint contracts:

```ts
type ConsentAction = 'approve' | 'deny';
type OAuthBackendOptions = {
  details?: Record<string, unknown>;
  detailsStatus?: number;
  resources?: string[];
};

class OAuthBackend {
  authorizationReads = 0;
  resourceReads = 0;
  consentActions: ConsentAction[] = [];

  constructor(private readonly options: OAuthBackendOptions = {}) {}

  async install(page: Page): Promise<void> {
    await page.route(`${supabaseOrigin}/auth/v1/oauth/authorizations/${AUTHORIZATION_ID}`, async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        this.authorizationReads += 1;
        return json(route, this.options.details ?? authorizationDetails(), this.options.detailsStatus ?? 200);
      }
      throw new Error(`Unexpected OAuth authorization request: ${request.method()} ${request.url()}`);
    });
    await page.route(`${supabaseOrigin}/auth/v1/oauth/authorizations/${AUTHORIZATION_ID}/consent`, async (route) => {
      expect(route.request().method()).toBe('POST');
      const body = route.request().postDataJSON() as { action?: ConsentAction };
      expect(body.action === 'approve' || body.action === 'deny').toBe(true);
      this.consentActions.push(body.action!);
      return json(route, { redirect_url: `${appOrigin()}/payment/success?oauth=${body.action}` });
    });
    await page.route(`${supabaseOrigin}/rest/v1/rpc/get_oauth_authorization_resource`, async (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toEqual({ p_authorization_id: AUTHORIZATION_ID });
      const resources = this.options.resources ?? [accountResource];
      const resource = resources[Math.min(this.resourceReads, resources.length - 1)];
      this.resourceReads += 1;
      return json(route, resource);
    });
  }
}
```

Register the longer `/consent` pattern before the base authorization pattern so Playwright's reverse registration order does not let the generic route capture consent requests. The approval test must sign in, install the backend, open `/oauth/consent?authorization_id=e2e-authorization`, assert `E2E MCP Client`, `read write`, and `the Keco account`, then click Approve. Assert two authorization reads, two resource reads, one `approve` decision, and final navigation to `/payment/success?oauth=approve`.

- [x] **Step 2: Run the approval test to verify RED**

Run:

```bash
npx playwright test tests/e2e/specs/oauth-consent.spec.ts --project=chromium --workers=1 --grep "approves"
```

Expected RED checkpoint: the test is discovered and initially exposes any mismatch in actual Supabase endpoint paths, response shapes, or consent rendering. Fix only the test fixture until the failure is a meaningful browser assertion.

- [x] **Step 3: Add denial, changed-request, and invalid-request cases**

Add these behaviors:

```ts
test('denies without approval revalidation and follows the access-denied callback', async ({ page }) => {
  // Load a valid account request, click Deny, then assert one details read,
  // one resource read, ['deny'], and /payment/cancel?oauth=deny&error=access_denied.
});

test('blocks approval when the authorization resource changes during revalidation', async ({ page }) => {
  // resources: [accountResource, `${accountResource}/${PROJECT_ID}`]
  // Click Approve, assert the page stays on /oauth/consent, the alert text is
  // "Authorization request changed before approval.", and no consent POST occurred.
});

test('disables both decisions for an unavailable or mismatched request', async ({ page }) => {
  // Return details with authorization_id: 'different-authorization'.
  // Assert the unavailable/expired alert and both Approve and Deny disabled.
});
```

For denial, assert there is no second details/resource call. For the changed-request case, assert exactly two reads of each endpoint and an empty `consentActions` array. For invalid details, assert the resource endpoint is never called.

- [x] **Step 4: Run the full OAuth spec to verify GREEN**

Run:

```bash
npx playwright test tests/e2e/specs/oauth-consent.spec.ts --project=chromium --workers=1
```

Expected: all OAuth consent tests pass, all callbacks stay on the Playwright origin, and no external OAuth provider is contacted.

---

### Task 3: Combined verification and coverage audit

**Files:**
- Verify: `tests/e2e/specs/billing.spec.ts`
- Verify: `tests/e2e/specs/oauth-consent.spec.ts`
- Verify: `docs/superpowers/specs/2026-09-19-billing-oauth-playwright-coverage-design.md`

**Interfaces:**
- Consumes: both completed specs.
- Produces: Evidence that both specs are isolated, discoverable, lint-clean, and type-correct under Playwright's TypeScript loader.

- [x] **Step 1: Run both specs together**

```bash
npx playwright test tests/e2e/specs/billing.spec.ts tests/e2e/specs/oauth-consent.spec.ts --project=chromium --workers=1
```

Expected: all tests pass and route handlers do not leak between browser contexts.

- [x] **Step 2: Confirm discovery**

```bash
npx playwright test --list | rg 'billing\.spec|oauth-consent\.spec'
```

Expected: every new billing and OAuth test is listed under Chromium.

- [x] **Step 3: Run focused lint and TypeScript checks**

```bash
npx eslint tests/e2e/specs/billing.spec.ts tests/e2e/specs/oauth-consent.spec.ts
npx tsc --noEmit --pretty false --allowJs false --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --esModuleInterop tests/e2e/specs/billing.spec.ts tests/e2e/specs/oauth-consent.spec.ts
```

Expected: both commands exit 0. If the standalone TypeScript invocation conflicts with repository ambient types, use Playwright discovery plus ESLint as the authoritative test-file compilation evidence and document the ambient-type conflict.

- [x] **Step 4: Review the final diff against the design**

Check that the diff contains only the design/plan and two Playwright specs, that no external callback URL is present, and that every Billing and OAuth coverage item in the design maps to an assertion.
