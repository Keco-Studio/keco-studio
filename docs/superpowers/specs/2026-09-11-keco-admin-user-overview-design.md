# Keco Admin User Overview Design

## Goal

Add an account-level Keco Admin workspace that only the designated Keco
administrator can discover or read. The first delivery presents the complete
resource-administration interface from the supplied reference while connecting
only the total user count to authoritative data. It must use Keco's existing
application shell and visual language rather than copying the reference HTML or
CSS.

## Scope

### In scope

- Add `Keco Admin` immediately above `Logout` in the avatar menu.
- Add a Keco Admin item below `System` in the product navigation rail.
- Show both entry points only to the configured administrator.
- Add the account-level route `/keco-admin`.
- Protect access and data on the server with one configured Supabase user UUID.
- Read the real total account count from Supabase Auth.
- Render the complete Credit, Stay, Storage, and user-detail UI with explicit
  unavailable states until those data sources are implemented.
- Provide loading, refresh, access-denied, service-error, narrow-screen, and
  reduced-motion behavior.

### Out of scope

- Changing registration behavior or account-uniqueness constraints.
- Resolving potential future email or normalized-username duplicates.
- Listing real users or exposing profile details in the first delivery.
- Defining Credit, Stay, Storage, plan, presence, or quota data models.
- Exporting reports, changing quotas, suspending users, or opening user details.
- Supporting multiple Keco administrators or an administrator-management UI.
- Copying code, CSS, inline SVG markup, or sample data from the supplied
  `/home/ltt/project/index.html` reference.

## Existing-data audit

The current local Supabase environment was inspected before design approval:

- `auth.users`: 9 records;
- `public.profiles`: 9 records;
- duplicate normalized Auth email groups: 0;
- duplicate normalized profile email groups: 0;
- duplicate normalized username groups: 0;
- Auth users without profiles: 0;
- profiles without Auth users: 0.

Normalization in this audit means trimming surrounding whitespace and comparing
case-insensitively. This is evidence about the current local environment only;
because uniqueness hardening is out of scope, it is not a guarantee for future
registrations.

## Administrator identity and configuration

The designated account is the unique Supabase Auth user resolved from the
approved administrator email during design:

```text
aae0969f-0cb2-4632-8624-b9f40f2f4543
```

Runtime authorization uses the server-only environment variable:

```text
KECO_ADMIN_USER_ID=aae0969f-0cb2-4632-8624-b9f40f2f4543
```

The email address is not embedded in source code or used for authorization.
The UUID is immutable for the lifetime of the Supabase user, while email can be
changed or reassigned. Missing, malformed, or non-matching configuration fails
closed.

## Authorization architecture

Create a server-only authorization helper that validates
`KECO_ADMIN_USER_ID` as one UUID and compares it with the authenticated user ID.
The browser never receives the configured UUID and never receives the Supabase
service-role key.

Two authenticated API boundaries enforce the policy:

1. `GET /api/keco-admin/access` returns `{ isAdmin: boolean }` for the current
   authenticated user. The avatar menu and product rail consume this response
   through one shared, cached query. Loading, unauthenticated, configuration
   failure, and request failure all hide the entry points.
2. `GET /api/keco-admin/overview` repeats the UUID check. A non-administrator
   receives `403`; an unauthenticated request receives `401`. Only after the
   check succeeds may the route create a service-role client and read the Auth
   user count.

Hiding navigation is a presentation rule, not the security boundary. A user
who manually opens `/keco-admin` cannot receive overview data. The page maps a
definitive `401` or `403` to the existing projects route, while transient server
errors stay on the page with a retry action.

Both endpoints return `Cache-Control: private, no-store`. Errors do not expose
configuration values, internal Supabase messages, or account records.

## User-count data contract

The overview route calls Supabase Auth Admin `listUsers` with a one-record page
and reads its authoritative `total` field. It does not count `profiles`, because
a delayed or failed profile trigger could make that table diverge from the Auth
identity source of truth.

The browser contract is deliberately small:

```ts
type KecoAdminOverview = {
  totalUsers: number;
  refreshedAt: string;
};
```

`totalUsers` must be a non-negative integer and `refreshedAt` must be an ISO
timestamp produced by the route after a successful read. No user rows, email
addresses, metadata, or provider response fields cross this boundary.

## Application shell and navigation

`/keco-admin` is an account-level special route, never a project ID. The route
uses the existing Keco `TopBar` and `LeftNav`, hides the Studio resource sidebar,
and hides the assistant chat panel so the administration workspace gets the
same focused product-shell treatment as Keco's dedicated tools.

The product rail adds an administrator-only shield/check item below `System`.
It is active only on `/keco-admin`. The avatar menu adds `Keco Admin` directly
above `Logout`; selecting either entry closes any open menu and navigates to the
same route. Existing Billing and MCP ordering remains unchanged.

## User experience

The page uses English UI copy to match the current Keco product. Its information
architecture follows the supplied reference:

1. A compact header contains `Keco Admin`, an `Admin only` status label, a
   last-refreshed value, and an icon-led refresh action.
2. Four equal overview panels show Total users, Credit usage, Storage used, and
   Stay duration.
3. Total users displays the live count and a restrained Keco-blue sync marker.
4. The other three panels remain visually complete but display an em dash and
   `Not connected`; they never display sample totals, changes, or quotas.
5. The user-detail area renders search, plan segments, filter affordance, the
   complete table header, and pagination placement. Controls that cannot act on
   real data are disabled and expose concise native tooltips.
6. The table body shows a single unavailable empty state. It contains no sample
   identities and does not imply that the real account set is empty.

Loading uses stable skeleton blocks so the layout does not shift. Refresh keeps
the last successful count visible while the new request is pending. A first-load
failure replaces the count with an error state and provides Retry. A refresh
failure retains the last count and announces that the refresh failed.

## Visual direction

The reference supplies hierarchy, not implementation or branding. The Keco
version uses the repository's existing Roboto/Nunito typography, Keco blue
`#0b99ff`, neutral white and gray surfaces, compact 8-pixel-or-smaller radii,
and existing hover/focus tokens. Icons come from the application's enabled icon
library rather than copied SVG paths.

The signature element is a thin live-data rail inside the Total users panel:
one Keco-blue rule connects the metric to its synced timestamp. The remaining
panels use quiet neutral unavailable treatment, making the one authoritative
metric unmistakable without turning the page into a promotional dashboard.

Desktop keeps the reference's dense four-column overview and data table. Medium
screens use two overview columns. Narrow screens use one overview column, keep
all controls within the viewport, and place the table in a labeled horizontal
scroll region. Font sizes remain fixed at the Keco scale rather than scaling
with viewport width. Keyboard focus is visible and reduced-motion preferences
remove non-essential transitions.

## Component boundaries

- `src/lib/server/kecoAdminAuthorization.ts`: parse and enforce the configured
  administrator UUID without exposing it to client code.
- `src/app/api/keco-admin/access/route.ts`: authenticated, fail-closed navigation
  capability response.
- `src/app/api/keco-admin/overview/route.ts`: authenticated administrator-only
  Auth user-count response.
- `src/lib/hooks/useKecoAdminAccess.ts`: shared cached capability query for
  `TopBar` and `LeftNav`.
- `src/app/(dashboard)/keco-admin/page.tsx`: account-level route shell.
- `src/components/keco-admin/KecoAdminDashboard.tsx`: overview state, refresh,
  metric panels, unavailable resource table, and error handling.
- `src/components/keco-admin/KecoAdminDashboard.module.css`: Keco-native layout,
  responsive rules, focus, and reduced-motion treatment.
- `src/components/layout/TopBar.tsx`: authorized avatar-menu entry.
- `src/components/layout/LeftNav.tsx`: authorized product-rail entry and active
  state.
- `src/components/layout/DashboardLayout.tsx`: Keco Admin shell branching.
- `src/lib/utils/routeParams.ts`: account-level special-route recognition.
- `.env.example`: document `KECO_ADMIN_USER_ID` without adding a live value.

Names may be adjusted during implementation to match nearby testable patterns,
but authorization and data boundaries remain separate from presentation code.

## Testing strategy

Implementation follows red-green-refactor:

- Authorization-helper tests cover exact match, mismatch, absent config,
  malformed config, and whitespace rejection.
- Access-route tests cover `401`, `{ isAdmin: false }`, `{ isAdmin: true }`, and
  fail-closed configuration behavior.
- Overview-route tests prove that non-admin requests return `403` without
  constructing or calling the service-role client, and that an administrator
  receives a validated total with no user records.
- UI tests cover hidden and visible avatar/rail entries, exact menu ordering,
  active navigation state, loading, live count, refresh, retained stale count,
  first-load error, unavailable metrics, unavailable table, and narrow-layout
  wiring.
- Route parsing tests prove `/keco-admin` has no project identity.
- Focused integration or browser coverage confirms that the approved account can
  enter through the avatar menu while another authenticated account sees no
  entry and receives no overview data.

Verification runs focused tests first, then unit tests, typecheck, lint, build,
and responsive browser screenshots when the environment provides a working
browser. The current container's Playwright Chromium is missing `libnspr4.so`,
so visual verification may require installing browser system dependencies or
running the existing browser suite in CI.

## Acceptance criteria

1. Only user `aae0969f-0cb2-4632-8624-b9f40f2f4543` sees `Keco Admin` directly
   above `Logout` and below `System` in the product rail.
2. Missing or invalid administrator configuration hides both entry points and
   causes the overview endpoint to deny access.
3. An unauthenticated overview request receives `401`; any other authenticated
   user receives `403` before service-role access occurs.
4. The approved administrator can open `/keco-admin` and see the real Auth user
   total plus a successful refresh timestamp.
5. Credit, Stay, Storage, and user-detail regions are all present but clearly
   unavailable, with no fictional numbers or identities.
6. The page uses Keco's existing shell, typography, colors, icons, density,
   focus treatment, and responsive behavior without copied reference code.
7. Loading and first-load errors do not show a false count; refresh errors keep
   the last successful count visible and offer a retry path.
8. No registration code or database uniqueness constraint changes in this
   delivery.
9. Existing authentication, navigation, Billing, MCP, dashboard-layout, and
   route-parsing behavior remains green.
