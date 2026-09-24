# Billing and OAuth Consent Playwright Coverage

## Goal

Add deterministic browser coverage for the account billing and MCP OAuth consent workflows. The tests must exercise the real Next.js pages, client components, authentication shell, Supabase browser client, and navigation behavior while replacing only external Stripe and OAuth server responses at the browser network boundary.

## Scope

Add two Playwright specs:

- `tests/e2e/specs/billing.spec.ts`
- `tests/e2e/specs/oauth-consent.spec.ts`

No production behavior or component API changes are planned. Existing unit tests remain responsible for exhaustive domain validation and low-level race permutations.

## Test Architecture

Both specs use a temporary user created through the existing Supabase admin fixture and authenticate through the real login UI. Tests run serially within each spec so fixture creation and cleanup remain deterministic.

External dependencies are replaced with `page.route` handlers:

- Billing intercepts only `/api/checkout`. It validates the browser request and returns either a same-origin payment result URL or a controlled error.
- OAuth consent intercepts the Supabase Auth authorization endpoints and the `get_oauth_authorization_resource` RPC. Project lookup is intercepted only for project-scoped scenarios.
- Callback redirects use same-origin test destinations so navigation is observable and no third-party host is contacted.

Route handlers record received method, URL, and request body. Assertions target rendered UI, control state, request payloads, and final navigation rather than merely asserting that a mock handler ran.

## Billing Coverage

### Billing Entry and Catalog

Precondition: an authenticated temporary user with a populated email profile.

Steps and expected results:

1. Open the avatar menu and choose Billing.
2. Confirm navigation to `/billing`.
3. Confirm Starter, Pro, Studio, and Enterprise plans render with their intended actions.
4. Select a plan card and confirm its pressed/selected state.

### Successful Checkout

Precondition: the checkout route is held pending and then returns a same-origin `/payment/success` URL.

Steps and expected results:

1. Choose Pro.
2. Confirm the request contains `planId: "plan-pro"` and the signed-in user's email.
3. While the response is pending, confirm every plan action is disabled and Pro shows its busy label.
4. Release the response and confirm the browser reaches the payment success page.
5. Confirm the payment-received content and that Return to billing navigates back to `/billing`.

### Failed Checkout

Precondition: `/api/checkout` returns a controlled non-2xx error.

Steps and expected results:

1. Choose a purchasable plan.
2. Confirm the server error is rendered to the user.
3. Confirm the busy state clears and plan actions become usable again.

### Canceled Checkout

Open `/payment/cancel`, confirm that no-payment content renders, and confirm Return to billing navigates to `/billing` for the authenticated user.

## OAuth Consent Coverage

The browser test matrix covers representative security boundaries without duplicating every combination already covered by `tests/unit/mcp/oauth-consent-behavior.test.ts`.

### Account Approval

Precondition: authorization details match the query ID, have no redirect URL, and the resource RPC returns the account MCP resource.

Steps and expected results:

1. Open `/oauth/consent?authorization_id=<id>`.
2. Confirm client name, requested scopes, and account target render.
3. Confirm Approve and Deny are enabled.
4. Choose Approve.
5. Confirm the component reloads authorization details and resource before submitting approval.
6. Confirm approval uses the original authorization ID and navigates to the controlled callback.

### Denial

Load a valid pending request, choose Deny, confirm no approval revalidation is required, and confirm navigation to the controlled access-denied callback.

### Changed Request Before Approval

Return one resource during initial load and a different resource during approval revalidation. Confirm approval is not submitted, the browser stays on the consent page, and `Authorization request changed before approval.` is shown.

### Invalid or Expired Request

Return an authorization error or mismatched authorization ID. Confirm the unavailable-or-expired error renders and both decision controls remain disabled.

## Stability and Cleanup

- Prefer response promises and locator state assertions; do not add fixed-duration waits.
- Each route handler rejects unexpected methods or payloads with a clear test failure.
- Temporary users are removed in `afterAll`, with defensive cleanup if setup fails partway through.
- Tests must pass independently and as part of the full Playwright suite.
- No real Stripe checkout, external OAuth callback, or production Supabase instance is used.

## Verification

1. Run each new spec independently with one worker.
2. Run both specs together to detect route or fixture leakage.
3. Run Playwright test discovery and confirm both specs are included.
4. Run focused lint and TypeScript checks for the new test files.

## Non-Goals

- Verifying Stripe-hosted Checkout UI or webhook delivery.
- Repeating payment domain and Stripe persistence unit tests.
- Exhaustively reproducing every OAuth stale-response race already covered by component tests.
- Changing billing, OAuth consent, or authentication production behavior.
