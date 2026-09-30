# Feature Specification: MVP 0.4.0 Release Test Alignment

**Created**: 2026-09-24
**Status**: In progress
**Input**: Align the current automated tests with the supplied MVP 0.4.0 dev-ting test plan and close verified execution gaps.

## Baseline

The comparison target is the supplied MVP 0.4.0 dev-ting test plan, sections
3-8.
The initial audit was performed at `5574aeee` on `main`. The plan names
`dev-ting` at `c7abc70f`; this specification is integrated on top of
`73a6b1a3` and must be revalidated against the intended release commit before
sign-off.

Existing automation includes 728 Jest suites, 49 Playwright spec files, 28 MCP
Deno test files, and 18 PixelLab map/character Deno test files. The latter 18
files are outside `test:mcp` and `validate`. Default local Jest skips the live
RLS database suites unless `RLS_DB_TESTS=1` and local credentials are set.

The six required automation additions in source plan section 3.2 map to the
following browser tests. A mock-backed test proves the application flow, but
does not replace the corresponding controlled service acceptance.

| Source gap | Automated test | Additional release evidence |
| --- | --- | --- |
| Credits UI (P0) | `tests/e2e/specs/account-credits.spec.ts` | Reconcile real ledger and UI balance |
| Email change (P1) | `tests/e2e/specs/account-email.spec.ts` | Real OTP delivery and expiry |
| Stripe webhook (P0) | `tests/e2e/specs/stripe-webhook.spec.ts` | Stripe test-mode Checkout and replay |
| Create Map mobile (P1) | `tests/e2e/specs/create-map-v3.spec.ts` (`@mobile`) | Device/browser smoke check |
| MCP role authorization (P0) | `tests/e2e/specs/mcp-authorization.spec.ts` | External OAuth client walkthrough |
| Cross-entry quota (P0) | `tests/e2e/specs/storage-quota-cross-entry.spec.ts` | Release data reconciliation |

## User Scenarios & Testing

### US-1 - A release gate runs every local Edge test (P0)

As a release engineer, I can run one documented command that executes MCP,
PixelLab map, and PixelLab character Deno tests. CI and the release validation
command use the same command, and any failure gives a nonzero exit code.

**Acceptance scenarios**:

1. Given a map or character Deno test failure, when the Edge test gate runs,
   then the gate fails and names the failing suite.
2. Given all three Edge suites pass, when CI and `validate` run, then neither
   silently omits map or character tests.

### US-2 - Local database behavior cannot be reported as passed when skipped (P0)

As a tester, I can run a local database gate that obtains credentials from the
running local Supabase stack and requires RLS behavior suites to execute.

**Acceptance scenarios**:

1. Given a running, migrated local Supabase stack, the gate runs the relevant
   account Credit, storage, map, GDS, OAuth, asset, email, and Slice behavior
   suites without skipped database tests.
2. Given no valid local stack or key, the gate fails before claiming success.
3. The gate refuses a non-local Supabase URL and never writes to a remote
   project.
4. Given database migration versions different from the repository, the gate
   fails before running behavior tests.

### US-3 - Create Map mobile collision painting is reliable (P1)

As a map editor on a touch device, I can tap and drag across collision cells,
close and reopen the inspector, and reload the map without losing the edits.

**Acceptance scenarios**:

1. A touch tap changes one cell; a drag across adjacent cells changes every
   crossed cell, with an observable blocked-cell count.
2. The saved grid has the same count after reopening and reloading.
3. The mobile Playwright test passes without relying on a desktop viewport.

### US-4 - Provider storage tests model current quota behavior (P0)

As a maintainer, the map background composition tests exercise reservation,
upload, read-back, finalization, and cleanup with a complete storage mock.
Passing tests cannot bypass the current quota contract.

**Acceptance scenarios**:

1. The background success and retry cases reach `ready` after a valid
   reservation and finalization response.
2. Failure cleanup can remove an uploaded object and release its reservation.
3. The complete map Deno suite passes as part of the Edge gate.

## Coverage Matrix

| Area | Automated evidence | Remaining controlled acceptance |
| --- | --- | --- |
| F01 Create Map | Jest, map Edge, desktop/mobile Playwright | Paid PixelLab generation and project binding |
| F02 GDS/GDD | Jest, MCP, conditional Playwright | LLM-backed worker completion, retry, source redaction |
| F03 Script/document/table | Jest and Playwright flows | Three-way edit conflict and role walkthrough |
| F04 Assets | Jest, MCP, Playwright upload | Local/Python image writeback and object inventory |
| F05 MCP/Slice | MCP Deno, OAuth Playwright, DB behavior | End-to-end Slice delivery and evidence read-back |
| F06 Character/animation | Jest and character Edge | Paid generation and spritesheet inspection |
| F07 Credits/Stripe | Jest, DB behavior, Credits and webhook Playwright | Stripe test-mode Checkout and ledger reconciliation |
| F08 Storage | Jest, DB behavior, cross-entry Playwright | Dry-run backfill/reconcile on release data |
| F09 Email/desktop | Jest and mock-backed email Playwright | Real OTP and desktop OAuth handoff |
| F10 Admin | Jest and Playwright | Admin data and access review on release environment |

## Functional Requirements

- **FR-001**: A single Edge test script MUST run all MCP, map, and character
  Deno test directories and fail if any directory fails.
- **FR-002**: CI and `validate` MUST invoke that complete Edge gate.
- **FR-003**: A local database gate MUST derive its URL and keys from local
  `supabase status`, set `RLS_DB_TESTS=1` and `REQUIRE_RLS_DB_TESTS=1`, and run
  the release-relevant live database behavior suites.
- **FR-004**: The database gate MUST fail closed if Supabase is unavailable or
  if migration history differs from the checkout, or if a selected suite skips
  its database tests.
- **FR-005**: Create Map mobile Playwright MUST verify drag painting and
  persistence; a failed cell-count assertion MUST remain a test failure.
- **FR-006**: Map background storage fixtures MUST return valid current quota
  RPC payloads and support cleanup methods used by production code.
- **FR-007**: Controlled paid, OAuth, Stripe, and storage reconciliation
  acceptance MUST remain explicit operator actions with recorded IDs and
  before/after ledger or quota values. Automation MUST NOT trigger paid work
  during ordinary CI.
- **FR-008**: The release record MUST include commit, environment, migration,
  command, result/artifact link, skipped tests, and accepted risk owner for
  every row in the coverage matrix.

## Execution Gates

The default local stack inspected on 2026-09-25 lacks migration versions
`20260924110000`, `20260924120000`, and `20260924133000` from this checkout.
Before integration with `73a6b1a3`, its storage behavior suite produced 4 RLS
failures out of 20 tests. On 2026-09-25, an isolated stack using the initial
checkout's migrations passed
`SUPABASE_TEST_WORKDIR=/tmp/keco-studio-release-db-20260924 npm run test:unit:db`
with 31 suites, 313 tests, 0 skipped, and exit code 0. After the isolated stack
was rebuilt with all migrations from `73a6b1a3`, the same gate passed again
with 31 suites, 313 tests, 0 skipped, and exit code 0. The default stack is
not valid release evidence; keep its migration drift visible until it is
resolved.

1. Run `npm run validate` against a running, migrated local Supabase stack. It
   includes static checks, all Edge suites, Jest, the required live database
   gate, and the build.
2. Run `npm run test:e2e:create-map-v3` and the focused browser tests in the
   table above against local services. Use a matching
   `KECO_CREATE_MAP_E2E_ORIGIN` when `PLAYWRIGHT_PORT` is changed.
3. Record paid generation, Stripe Checkout, desktop OAuth, OTP delivery, and
   storage reconciliation under source plan sections 5 and 8 before release.

## Success Criteria

- **SC-001**: MCP, map, and character Deno suites all exit 0 through one
  command and through CI.
- **SC-002**: The selected live database suites execute with zero skipped tests
  on a migrated local stack.
- **SC-003**: The Create Map mobile touch case passes and retains its edited
  grid after reload.
- **SC-004**: No P0 suite is absent from a release gate or reported as passed
  when it was skipped.
- **SC-005**: The release decision has a filled execution record for each
  controlled acceptance item, or an explicit risk acceptance under the source
  plan's section 7 rules.

## Out of Scope

- Changing product behavior outside a demonstrated test failure.
- Automatically performing paid generation, live Stripe Checkout, desktop
  OAuth, or production storage repair in CI.
- Treating mock-backed browser tests as proof of real third-party integration.
