# Document Loading Performance Design

## Goal

Reduce the time spent behind `Loading document...` on both standard document
routes and Script workspace document routes without weakening project,
document, or workspace access checks.

## Current Problem

The standard document route loads the full document first and only then starts
the project-role request because permission loading depends on
`document.project_id`. The role request does not reuse the project-role query
already mounted by the top bar. Its API handler authenticates the user and then
performs project and collaborator lookups sequentially.

The Script workspace route adds another serial gate before the document editor
mounts. It fetches the complete workspace membership list, including document
metadata, to answer whether one document belongs to the workspace. Only after
that request succeeds does the standard document startup sequence begin.

## Chosen Approach

Use one shared client-side document bootstrap flow. It starts all independent
queries as soon as the route parameters and authenticated user are available:

1. Load the document record through the existing Supabase/RLS path.
2. Load the project role through the existing `queryKeys.projectRole` React
   Query entry, sharing the top bar's 30-second cache.
3. On Script workspace routes only, check membership for the requested
   `documentId` through a targeted API endpoint.

The bootstrap flow waits for all required results, verifies that the returned
document belongs to the route project, and only then mounts the collaboration
session and editor. Independent network latency is therefore concurrent rather
than cumulative.

## Components

### Shared Document Bootstrap

A focused hook owns document startup state. Its inputs are `projectId`,
`documentId`, and whether Script workspace membership is required. It composes
the existing document and project-role queries with the optional targeted
membership query.

The hook returns either a ready document and permission object, a loading state,
or a user-facing denial/error. `DocumentEditor` continues to own collaboration
and editor rendering after bootstrap succeeds.

Session-derived fields needed by collaboration, including `userId`, access
token, and display name, remain part of the permission result. Reading the local
Supabase session must not delay starting the document query.

### Project Role Reuse

Document permissions use the same `queryKeys.projectRole(projectId, userId)`
query as `useProjectRoleQuery`. This removes the editor-specific uncached role
request and allows the top bar and document bootstrap to deduplicate concurrent
requests.

The document's `project_id` is no longer a prerequisite for starting the role
query. It remains a mandatory validation after the document is returned.

### Targeted Script Membership

Add a GET endpoint scoped by `projectId` and `documentId`. It authenticates the
request and returns whether that exact document is present in the project's
Script workspace. It does not load the workspace's complete membership list or
document metadata.

The Script document page starts the editor bootstrap immediately with Script
membership required. It does not render a document or create a collaboration
session until membership is confirmed.

The existing full-list endpoint remains for the Script sidebar and import
flows. Mutations that add or remove workspace documents invalidate both the
full-list query and the affected targeted-membership query.

## Data Flow

Standard document route:

```text
route parameters
  +-- document query --------------------+
  +-- local session -> cached role query-+--> project match -> editor session
```

Script workspace document route:

```text
route parameters
  +-- document query --------------------+
  +-- local session -> cached role query-+
  +-- targeted membership query --------+--> all checks pass -> editor session
```

## Authorization And Error Handling

- Document access continues to rely on the existing Supabase client and RLS.
- A valid project role remains required before the editor mounts.
- `document.project_id` must equal the project ID in the route.
- Script routes additionally require a positive targeted membership result.
- A membership denial redirects to the Script workspace with the existing
  message. Network or server failures use the existing failure message and do
  not get treated as a definitive non-member result.
- Failed document and role queries continue to show document access/loading
  errors without exposing response details.

## Caching

- Project role: reuse the existing 30-second React Query cache and query key.
- Document: use the shared query key and avoid forced window-focus refetches;
  explicit invalidation and realtime document events remain authoritative.
- Targeted Script membership: use a short React Query stale time. Invalidate it
  alongside the full workspace membership query after membership mutations.
- Do not add a second server-side authorization cache in this change.

## Testing

Focused tests will cover:

- document and role work starting without waiting for `document.project_id`;
- role requests sharing the top bar's React Query key and cache;
- Script document startup using the targeted membership query instead of the
  full workspace list;
- a non-member never mounting the editor and following the existing redirect;
- a cross-project document being rejected after the document query resolves;
- membership API success, denial, authentication failure, and service failure;
- existing document permission and collaboration wiring remaining green.

Verification will include the focused Jest suites, TypeScript checking, and the
relevant existing document and Script workspace tests.

## Non-Goals

- Replacing Supabase RLS or project-role authorization.
- Combining document content, role, and membership into a new aggregate API.
- Changing collaboration hydration or editor bundle contents.
- Redesigning the loading UI.
- Refactoring the Script sidebar's legitimate full workspace listing.
