# MCP Account Connections Page Design

**Date:** 2026-07-24
**Status:** Approved for implementation planning
**Audience:** Keco creators connecting their account to Codex or Claude Code

## 1. Summary

Keco will add an account-level MCP page at `/mcp`. The page has two purposes:

1. Show the exact commands needed to connect the current Keco account to Codex
   or Claude Code.
2. List the current account's completed account-scoped MCP OAuth connections and
   allow the user to disconnect one connection at a time.

The page is an account setting, not a project feature. It does not list projects,
project roles, MCP tools, prompts, resources, example prompts, or protocol
details. It does not execute client commands for the user.

## 2. Entry And Routing

- Add an `MCP` item to the user-avatar menu in `TopBar`.
- Place `MCP` immediately above `Logout`.
- Clicking it closes the menu and routes to `/mcp`.
- The route uses the existing authenticated dashboard layout and top bar.
- The page breadcrumb is `Account / MCP`.
- The page does not add an item to the product rail or project sidebar.

## 3. Page Structure

The page is one restrained settings view with two full-width sections in a
constrained content column. It reuses the current Keco workspace visual system:
white background, compact top bar, 14px body text, thin gray dividers, modest
6-8px radii, existing button treatment, existing table treatment, and existing
confirmation modal treatment. It must not introduce a marketing hero, nested
cards, decorative gradients, oversized type, or a separate visual theme.

### 3.1 Header

- Heading: `MCP`
- Supporting text: `Connect Keco to an AI coding client and manage access for
  this account.`

### 3.2 Connect A Client

The first section is titled `Connect a client` with supporting text:

`Run these commands in your terminal, then complete sign-in in the browser.`

Use a compact segmented control with two choices:

- `Codex`
- `Claude Code`

Codex is selected by default. The selected client changes only the instructions
shown below it. It does not perform a connection or make a network request.

#### Codex instructions

Step 1, `Add Keco MCP`:

```text
codex mcp add keco-account --url "https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp" --oauth-resource "https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp"
```

Step 2, `Sign in to Keco`:

```text
codex mcp login keco-account
```

#### Claude Code instructions

Step 1, `Add Keco MCP`:

```text
claude mcp add --transport http keco-account "https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp"
```

Each command appears in a code field with a copy icon button and tooltip. Long
commands wrap naturally onto a second visual line. The code field must not show
a horizontal scrollbar. Copying always writes the original complete single-line
command to the clipboard, without inserted line breaks. After a successful copy,
the icon temporarily changes to a check and the tooltip reads `Copied`.

### 3.3 Connected Clients

The second section is titled `Connected clients` with supporting text:

`Clients authorized to access Keco through this account.`

Use the existing collaborator-list table language rather than individual cards.
The desktop columns are:

| Column | Content |
| --- | --- |
| `CLIENT` | Client icon and `Codex`, `Claude Code`, or `MCP Client` |
| `CONNECTED` | The completed OAuth exchange time in the user's locale |
| unlabeled action | `Disconnect` button aligned to the end |

Sort connections by `connectedAt DESC`, with a stable opaque connection ID as
the tie-breaker. Multiple connections from the same client are shown as separate
rows. Device and operating-system labels are intentionally omitted because OAuth
clients do not reliably provide them.

On narrow screens, hide the connected-time column and retain the client identity
and disconnect action. The command fields continue to wrap without horizontal
page scrolling.

## 4. Connection Model

The existing `public.oauth_mcp_service_grants` table remains the source of truth.
Each completed account-scoped OAuth code exchange creates one grant bound to an
exact tuple of current Keco user, OAuth client, OAuth session, and account MCP
resource. One grant therefore represents one connection row. No second connection
tracking table is added.

A connection is listed only when all of the following remain true:

- the grant belongs to the current authenticated Keco user;
- the grant resource exactly equals the production account MCP endpoint;
- the referenced OAuth session still exists and belongs to the same user and
  OAuth client;
- the matching OAuth consent is not revoked;
- the grant has completed exchange timestamps.

The UI does not infer online or offline state. Presence in this filtered list is
the only connected state in the first release.

## 5. Client Classification

Classify a connection using the registered OAuth client display name, normalized
to lowercase:

- a name containing `codex` displays as `Codex`;
- a name containing `claude` displays as `Claude Code`;
- all other names display as `MCP Client`.

Classification is display-only. Authorization never depends on the client name.
The API does not return the raw OAuth client ID or raw registered client metadata.

## 6. API Contract

Add authenticated same-origin routes:

```text
GET /api/mcp/connections
DELETE /api/mcp/connections/{connectionId}
```

Both routes require the current Keco browser session. They must fail closed when
the user is unauthenticated or when ownership cannot be established. Service-role
credentials stay server-side and are never returned to the browser. The routes
call two narrowly scoped `SECURITY DEFINER` database functions executable only by
`service_role`: one lists valid connections for an explicit user ID and one
atomically revokes an explicit user's exact connection. Direct table access stays
revoked.

### 6.1 List Connections

Successful response:

```json
{
  "connections": [
    {
      "id": "opaque-connection-id",
      "client": "codex",
      "clientName": "Codex",
      "connectedAt": "2026-07-24T02:30:00Z"
    }
  ]
}
```

Allowed `client` values are `codex`, `claude`, and `unknown`. The `id` is a
versioned HMAC-SHA-256 token generated server-side over the authenticated user ID
and the grant authorization ID, using a dedicated connection-ID signing secret.
It must not be a raw client ID, session ID, authorization ID, access token,
refresh token, or reversible concatenation of those values. The signing secret is
server-only, independent from OAuth tokens and MCP cursor secrets, and available
in every Vercel environment that serves this API.

The route does not return project IDs, roles, capabilities, OAuth scopes, tokens,
session IDs, authorization IDs, or raw client metadata.

### 6.2 Disconnect A Connection

The delete route accepts only the opaque ID. The server lists only the current
user's eligible grant identifiers through the service-role-only list function,
recomputes each candidate HMAC, and uses constant-time comparison to resolve the
matching authorization ID. It then calls the service-role-only revoke function
with the current user ID and matched authorization ID.

The revoke function locks the grant row, verifies the user, resource, session, and
client relationship again, deletes the exact `auth.sessions` row, relies on the
existing foreign-key cascade to remove the grant, and verifies that the grant no
longer exists before returning success. These checks and mutations occur in one
database transaction.

Disconnecting one row must not revoke the current Keco browser session, another
MCP connection for the same user, another user's connection, or the entire OAuth
client consent. Retaining client consent lets other separately authorized Codex
or Claude Code instances continue to work. The disconnected client's existing
access token and refresh token must no longer authorize MCP requests.

Return success for the connection that was revoked. A missing connection or a
connection owned by another user returns the same `404` response so the endpoint
does not reveal its existence. Repeated deletion is safe and does not affect any
other session.

## 7. UI States And Interactions

### Loading

- Render two compact skeleton table rows while loading connections.
- Keep the client commands usable while the list loads.

### Empty

- Render `No MCP clients connected.` in the table area.
- Do not use a large illustration or card.

### List Error

- Render the existing compact error-banner style beneath the section heading.
- Include a `Retry` action.
- Do not hide the connection instructions.

### Disconnect Confirmation

Reuse the existing confirmation dialog pattern:

- Title: `Disconnect {clientName}?`
- Body: `This client will no longer be able to access Keco.`
- Actions: `Cancel` and destructive `Disconnect`

During deletion, disable only the selected row and its dialog confirmation. On
success, remove the row and show a short success toast. On failure, retain the
row, close or release the pending state, and show an error. The UI must not claim
that a connection was removed until the server confirms revocation.

### Refresh Behavior

Fetch the connection list when the page opens, when the browser window regains
focus, and after a successful disconnect. Do not add continuous polling, online
presence, or last-active tracking in the first release.

## 8. Security And Privacy

- Every list and delete operation scopes data to the authenticated user on the
  server.
- The browser never receives OAuth access tokens, refresh tokens, client secrets,
  session IDs, authorization IDs, or raw client IDs.
- The opaque connection ID is a versioned, user-bound HMAC token verified with
  constant-time comparison.
- Revocation is enforced by removal of the exact OAuth session, not merely by
  hiding a row in the UI.
- API responses use `Cache-Control: no-store`.
- Logs and telemetry must not contain tokens, cookies, authorization codes, PKCE
  values, session IDs, or the opaque connection ID in plaintext.
- The delete operation is protected by the existing same-origin browser session
  controls and must reject cross-origin requests according to the repository's
  API security pattern.

## 9. Accessibility

- The Codex and Claude Code selector uses tab semantics or an equivalent
  accessible segmented-control pattern.
- Copy icon buttons have accessible labels naming the command.
- Disconnect buttons include the client name in their accessible label.
- Loading, error, success, and copied feedback are announced without moving focus.
- The confirmation dialog traps focus, restores focus to the originating row, and
  supports Escape to cancel.
- Keyboard focus indicators reuse the existing Keco focus treatment and remain
  visible against white and light-gray surfaces.

## 10. Testing And Acceptance

Automated coverage must verify:

- the avatar menu places `MCP` above `Logout` and routes to `/mcp`;
- the page is inaccessible without a Keco browser session;
- exact Codex and Claude Code commands are rendered and copied as single lines;
- long command text wraps without horizontal scrolling at desktop and mobile
  widths;
- list responses include only the current user's valid account-scoped grants;
- raw OAuth identifiers and credentials never appear in the response;
- client names classify as Codex, Claude Code, or MCP Client;
- duplicate client types render as separate connections;
- disconnecting a connection revokes only its exact OAuth session and grant;
- the disconnected access token and refresh token can no longer call account MCP;
- another connection for the same client and user continues to work;
- another user's connection cannot be listed or disconnected;
- loading, empty, error, retry, confirmation, success, and failure UI states behave
  as specified;
- the connected-time column is hidden on narrow screens without obscuring actions.

Build and end-to-end acceptance use the real configured Vercel and Supabase
environments in accordance with the project verification policy. Credential and
evidence safety scans remain mandatory for authenticated MCP acceptance output.

## 11. Non-Goals

- Project lists, project roles, or project-level MCP connection status
- MCP tool, resource, or prompt catalogs
- Example prompts after connection
- Automatic client installation or command execution
- Operating-system detection or platform-specific command generation
- Device naming, connection renaming, or device fingerprinting
- Online/offline state, last-used timestamps, or continuous polling
- Bulk disconnect, disconnect-all, or OAuth client-consent administration
- Editing legacy project-scoped MCP connections
