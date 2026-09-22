# Critical Playwright Flows Design

## Goal

Add reliable Playwright coverage for the six release-critical flows: account Credits, email changes, Stripe webhook idempotency, Create Map mobile interaction, MCP role authorization, and account storage quota enforcement across entry points. Implement the missing account email-change UI required by that coverage.

## Delivery Boundaries

The work is split into three independently verifiable groups:

1. Account UI: Credits rendering and recovery states, plus email-change behavior.
2. Payment and authorization: signed Stripe webhook replay and OAuth-backed MCP role enforcement.
3. Mobile and storage: touch-capable Create Map interaction and concurrent quota reservations across browser, MCP, map, and character entry points.

The Playwright suite must remain deterministic. Tests may use the configured Supabase environment only with uniquely named temporary users, projects, orders, OAuth clients, and storage paths. Every live-data suite owns its cleanup in `afterAll`, including defensive cleanup after partial setup.

## Test Architecture

Use a hybrid boundary:

- Browser behavior runs against the real Next.js pages and client components.
- Supabase-backed invariants run against the configured test/online Supabase project with temporary data.
- Stripe webhook requests use locally generated test signatures and the real local Next.js webhook route. They do not contact Stripe's network.
- MCP authorization performs dynamic OAuth client registration, browser login and consent, PKCE code exchange, and JSON-RPC calls against the configured account MCP endpoint.
- PixelLab and email delivery are never invoked from the automated suite. Their network boundaries are replaced with deterministic responses while the real application state machine remains under test.
- Live suites must fail with a clear configuration error when their required Supabase capabilities are absent. They must not silently convert missing infrastructure into a passing assertion.

## Account Credits UI

Create a dedicated account Credits Playwright suite. It authenticates through the real login UI, intercepts only `GET /api/account/credits`, and opens the real `/account` page.

Required scenarios:

- Render allocated, used, and remaining values, including fractional Credits with no precision loss beyond the UI's six-decimal display contract.
- Render DeepSeek token usage and the tracking start date when those values are part of the account summary UI.
- Render the unpriced-event warning when `incompleteCount` is positive and verify those events are not added to Used.
- Preserve the last successful values when a refetch fails and show the refresh-failure alert.
- Recover when Retry succeeds after an initial-load failure.

The fixture records request count and returns responses in a declared sequence so refresh and retry behavior are observable without timing sleeps.

## Email Change Flow

Replace the read-only account email section with a staged flow backed by Supabase Auth:

1. The user enters their current email and proposed new email.
2. The client compares the normalized current-email input with the authenticated user's authoritative email. A mismatch stops before any mutation request.
3. A matching request calls `supabase.auth.updateUser({ email: newEmail })` and moves to OTP verification.
4. The verification step calls `supabase.auth.verifyOtp` for the pending email-change token.
5. A successful verification refreshes the authoritative user, clears pending UI state, and displays the new email.

The pending new email is restored from the authenticated Supabase user on reload rather than trusted from browser storage. Wrong and expired OTP errors remain distinguishable, keep the verification form usable, and never replace the displayed current email. Cancel clears only the local form; it does not claim to revoke a server-side email request.

Playwright intercepts the relevant Supabase Auth endpoints so it can cover current-email mismatch, request success, successful OTP, incorrect OTP, expired OTP, and reload restoration without reading a real mailbox. Unit tests cover normalization, state transitions, and error-message mapping before the browser spec is enabled.

## Stripe Webhook Idempotency

Add a Playwright API test that creates a temporary user and a pending payment order tied to a catalog plan. The test sends a `checkout.session.completed` event to `/api/webhooks/stripe` with a locally generated Stripe test signature.

After the first delivery it asserts:

- the order is paid;
- the Stripe payment-intent identity is stored;
- exactly one allocation ledger row exists for the order;
- the account Credit balance increased by exactly the plan allocation;
- exactly one webhook event is recorded.

The same serialized event and event ID are then sent again. The second response is successful, while every order, ledger, balance, and event count remains unchanged. A concurrent duplicate-delivery case is also included because a read-before-write webhook check alone is insufficient protection. The production path must rely on a database uniqueness/atomicity boundary, not only the early `hasWebhookEvent` check.

The Playwright web server receives a deterministic test webhook secret. No real Stripe secret, checkout session, or external API request is needed.

## MCP OAuth Role Matrix

Create an owner project with three temporary collaborators: admin, editor, and viewer. Register one temporary public OAuth client and perform a complete PKCE authorization flow for each role through the real consent page.

For each exchanged bearer token, call MCP `initialize`, `tools/list`, and representative `tools/call` operations:

| Role | Tool discovery | Read call | Write call |
| --- | --- | --- | --- |
| viewer | Read-only project surface; no project write tools | succeeds | hidden tool returns method-not-found or an explicit authorization failure |
| editor | Read and editor write tools | succeeds | representative editor write succeeds |
| admin | Full project write surface including admin-only operation | succeeds | representative admin-only write succeeds |

The assertions compare explicit required and forbidden tool names rather than snapshotting the complete list. This keeps the test stable as unrelated tools are added. Cleanup revokes OAuth connections, deletes the dynamic client, removes the project, and deletes all temporary users.

## Create Map Mobile Interaction

Enable a touch-capable mobile Playwright project based on Pixel 5. Limit that project to mobile-tagged tests so the entire desktop suite is not duplicated.

Extend the Create Map mocked workflow with one mobile interaction test that:

- starts with the inspector visible;
- closes the inspector, opens and closes the source panel, then reopens the inspector and verifies its prior map state is still present;
- uses `touchscreen.tap` and touch/pointer movement on the editable collision overlay;
- verifies the blocked-cell count changes, autosave completes, and the changed grid is restored after reload;
- checks for horizontal overflow, page errors, failed browser requests, and a nonblank screenshot.

The existing desktop mouse collision test remains because it covers a distinct input path.

## Cross-Entry Storage Quota

Use one temporary owner and projects representing browser, MCP, map, and character upload entry points. Set a small temporary owner quota and issue reservations concurrently with payloads whose combined size exceeds the remaining allowance.

The test must prove:

- successful reservations across all entry points share the same owner counter;
- committed plus active reserved bytes never exceed the owner quota;
- at least one competing request receives the normalized quota-exceeded result;
- an entry-point failure after reservation releases its reservation;
- retrying after release can consume the freed capacity;
- cleanup leaves no active reservation or stored object created by the test.

Browser and MCP use their public preparation APIs. Map and character use their real Edge-function storage adapters with the provider call replaced before any paid generation. If the configured remote environment cannot replace those provider boundaries, the suite invokes the same exported entry-point handler locally with real Supabase persistence; direct calls to the reservation RPC alone do not count as cross-entry coverage.

## Failure Handling And Isolation

- Tests use locator state, response promises, and database polling with deadlines; fixed sleeps are prohibited.
- Temporary resource names include a run UUID.
- Cleanup is idempotent and runs even when setup fails midway.
- Failure messages identify whether the browser, application route, OAuth server, MCP endpoint, Edge function, or database invariant failed.
- Tests do not log credentials, bearer tokens, OTPs, signed upload URLs, service-role keys, or raw webhook signatures.
- Tests against configured online infrastructure run serially within their own suites, while independent mocked UI suites may run in parallel.

## Verification Gates

Each group is complete only when:

1. Its focused unit tests pass.
2. Its Playwright specs are discovered under the intended desktop/mobile projects.
3. Its focused Playwright run passes from a clean temporary-data state.
4. Focused ESLint and TypeScript checks pass.
5. A second focused run passes, proving cleanup and replay isolation.

The final gate runs the six critical specs together with one worker for live-data suites, followed by the normal Chromium suite discovery check.

## Non-Goals

- Testing Stripe-hosted Checkout UI or contacting the Stripe API.
- Reading OTPs from a production mailbox.
- Running paid PixelLab generation.
- Snapshotting every MCP tool name.
- Duplicating every desktop Playwright test on mobile.
- Changing account identity authority away from Supabase Auth.
