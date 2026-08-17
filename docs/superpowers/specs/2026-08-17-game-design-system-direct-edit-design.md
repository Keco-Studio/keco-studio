# Game Design System Direct Edit Design

## Goal

Let a user edit a personal Game Design System directly without creating and
switching to a separate `(Copy)` system.

## Scope

- Personal systems expose a clear `Edit document` action.
- Clicking the action opens the document editor for the version currently shown.
- Saving creates a new immutable version in the same personal system.
- `Edit details` continues to edit only the system name, summary, and status.
- Official presets are read-only and expose no edit or copy action.
- The existing copy API remains in place for compatibility, but this workspace
  no longer exposes or calls it.

## Interaction

The personal-system header contains `Edit details`, `Edit document`, and delete.
`Edit document` switches to the Overview view when necessary and opens the
existing document editor immediately. The editor starts from the version that
was visible when the action was selected.

Cancel returns to the readable Overview without saving. Save uses the existing
version-creation path and selects the newly created version after the request
succeeds. A failed request leaves the editor available for correction or retry
and shows the existing error feedback.

Official preset headers contain none of these mutation actions.

## Implementation Boundaries

- Move document-edit activation to state owned by
  `GameDesignSystemWorkspace` so both the header action and Overview editor use
  one source of truth.
- Keep document editor and version service contracts unchanged.
- Remove the workspace copy mutation and its `Copy and edit` button.
- Do not remove the copy API, service function, or database provenance support.

## Verification

- A personal system shows `Edit document` and no `Copy and edit` action.
- Clicking the header action opens the document editor directly.
- Saving creates a version on the original system and does not call the copy API.
- An official preset shows no edit or copy actions.
- Cancel and save keep their existing behavior.

