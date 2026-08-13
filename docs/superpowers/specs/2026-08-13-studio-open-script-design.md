# Studio Open Script Design

Date: 2026-08-13
Status: Approved design

## Summary

Add an `Open script` action to the Studio document context menu. The action switches to Script immediately, imports the selected Studio document into the Script workspace, opens the newest existing conversation when one exists, or generates one for an admin or editor when needed. A viewer can import and open the Script document but cannot generate a conversation.

The final conversation route reuses the current Script dialogue editor and Flow chart. This feature does not create a second script renderer, graph model, or generation pipeline.

## Goals

- Show `Open script` in the Studio document context menu for every project member.
- Switch from Studio to Script as soon as the action is selected.
- Add the source document to the Script workspace idempotently.
- Open the newest existing script derived from the document without generating a duplicate.
- When no script exists, automatically generate and open one for admins and editors.
- When no script exists, let viewers open the imported Script document without generating.
- Keep the Script sidebar's existing `Generate conversation` permission consistent: admins and editors may generate; viewers may not.
- Present deterministic loading, permission, and error states instead of a blank transition page.

## Non-Goals

- Redesigning the existing dialogue editor or Flow chart.
- Changing the Story IR import or script compilation format.
- Regenerating an existing script from `Open script`.
- Adding a script chooser when a document has multiple scripts.
- Granting viewers permission to create derived libraries.
- Changing ordinary Studio library creation permissions.

## User Flow

1. A member opens a Studio document's context menu and selects `Open script`.
2. Studio immediately navigates to `/script-system/{projectId}/open/{documentId}`.
3. The transition route adds the document to `script_workspace_documents` using the existing idempotent workspace API.
4. The route queries script libraries whose `source_document_id` is the selected document and whose `document_export_type` is `script`.
5. If one or more scripts exist, the route selects the row with the newest `created_at` and replaces the URL with `/script-system/{projectId}/script/{libraryId}`.
6. If no script exists:
   - an admin or editor generates a conversation through the existing document-derived import pipeline and opens the new script route;
   - a viewer replaces the URL with `/script-system/{projectId}/doc/{documentId}` and can view the imported source document in Script.

The transition route uses replace-style final navigation so Back returns to the Studio origin instead of replaying automatic generation.

## Architecture

### Studio Context Menu

Add an `open-script` context-menu action for document rows. It is visible to admins, editors, and viewers. The Studio sidebar handler only closes the menu and navigates to the transition route; it does not perform long-running generation while the user remains in Studio.

### Script Transition Route

The client route `/script-system/[projectId]/open/[documentId]` owns the orchestration and has one active attempt at a time. It renders inside the existing Script layout so the product switch is immediate and the Script sidebar/top bar remain consistent.

The route composes existing capabilities:

- `POST /api/script-workspace/{projectId}` for idempotent membership creation.
- A focused query for derived script libraries belonging to the selected document.
- `fetchDocumentExportSource` and `runDocumentDerivedImport` with `exportType: 'script'` for generation.
- Existing query invalidation and Script workspace refresh behavior.
- Existing `/script-system/{projectId}/script/{libraryId}` and `/doc/{documentId}` routes.

The orchestration should be extracted into a small hook or service with explicit results (`open-script`, `open-document`, or `error`) so routing behavior can be tested independently from presentation.

### Existing Script View

The generated or existing library opens through the current `ScriptSplitView`. Its visual-novel dialogue area and `FlowChartPanel` remain the authoritative dialogue-tree interface. No new tree UI is introduced by the transition route.

## Script Lookup And Duplicate Avoidance

Existing scripts are matched by all three fields:

- `project_id = projectId`
- `source_document_id = documentId`
- `document_export_type = 'script'`

Results are ordered by `created_at DESC`, with a stable secondary ordering by ID, and the first result is opened. `Open script` never regenerates when a matching script exists.

Before starting generation, the transition route checks for an existing script. If generation fails, it checks again before showing an error. This handles the common race in which another tab or member created the script during the request. A retry repeats lookup before generation.

Client single-flight protection prevents the route effect, React development behavior, or rapid retries from starting overlapping requests in one page instance. Existing same-folder name validation remains a final database/service guard; it is not the primary deduplication mechanism.

## Permissions

| Capability | Admin | Editor | Viewer |
| --- | --- | --- | --- |
| See and select `Open script` | Yes | Yes | Yes |
| Add document to Script workspace | Yes | Yes | Yes |
| Open imported Script document | Yes | Yes | Yes |
| Open an existing derived script | Yes | Yes | Yes |
| Generate a missing conversation | Yes | Yes | No |

The current `script_workspace_documents` insert policy permits owners and admin/editor collaborators only. Add a migration that permits any accepted project collaborator, including viewers, to insert a membership row for a document in that project. The service continues to verify that the document belongs to the requested project. Select access remains unchanged.

Conversation generation uses a dedicated application-level admin-or-editor permission check, matching the existing libraries insert RLS policy. The shared permission used by ordinary Library creation remains admin-only. The Script document context menu displays `Generate conversation` to admins and editors and hides it from viewers.

This permission adjustment is limited to the conversation-generation path. It does not widen the UI permission for ordinary library creation or unrelated admin-only controls.

## Interface States

The transition view is a quiet, unframed Script workspace status surface rather than a new decorative card. It uses the existing Script typography, colors, spacing, and progress conventions.

- `Opening script`: importing workspace membership and looking for existing scripts.
- `Generating conversation`: running the existing generation pipeline for an admin or editor.
- Error: an actionable message with `Retry` and `Back to Studio document` commands.

A viewer with no existing script is routed directly to the Script document after membership succeeds, so permission limitations do not block document import or leave the viewer on the transition page.

Controls have stable dimensions, visible keyboard focus, and disabled/busy states. Status text uses `aria-live` so asynchronous progress is announced without stealing focus.

## Error Handling

- Invalid project/document association or lost project access stays on the transition route with a clear error.
- Workspace import failure offers Retry and a route back to the Studio document.
- Empty-document or generation failure uses the existing derived-import error message, then performs the final existing-script lookup before exposing Retry.
- A viewer never calls the generation endpoint.
- Retry starts a fresh lookup-first attempt and cannot overlap an active attempt.
- Returning to Studio navigates to `/{projectId}/doc/{documentId}`.

## Testing

Focused unit and component tests cover:

- The Studio document menu renders `Open script` for admin, editor, and viewer roles and emits the new action.
- The Studio action navigates immediately to the Script transition route.
- Workspace membership creation is idempotent.
- One existing script opens without generation.
- Multiple scripts open the newest `created_at` row deterministically.
- Admin and editor roles generate when no script exists, then open the returned library.
- A viewer with no script imports successfully and opens the Script document without a generation request.
- Generation failure performs a final lookup, opens a concurrently created script when found, and otherwise exposes Retry.
- Repeated effects/clicks do not produce overlapping generation calls.
- The Script document menu exposes `Generate conversation` to admins and editors but not viewers.
- The workspace API and RLS migration permit accepted viewers to add membership while rejecting non-members and cross-project documents.
- The existing script route continues to render `ScriptSplitView` with the Flow chart.

Verification includes focused Jest tests, migration/static policy tests, TypeScript checking, ESLint for touched files, and the relevant Script workspace/document-derived Playwright flow when the authenticated local test environment is available.

## Acceptance Criteria

- Every project member sees `Open script` on a Studio document.
- Selecting it immediately switches to the Script layout.
- Existing scripts open directly, choosing the newest created script when several exist.
- Admins and editors automatically generate and open a script only when none exists.
- Viewers successfully import and open the Script document but never generate.
- The final script screen uses the existing dialogue editor and Flow chart.
- Failures are recoverable and do not intentionally create duplicate scripts.
