# Library Project Foundation Design

**Date:** 2026-10-30

## Goal

Connect project creation to the Library workspace so a newly created project is immediately selectable and its default Resources folder is available. Collect the project's basic game information during creation and make Settings the only place where that information can later be edited.

Document simplification is not part of this change.

## Project Foundation

Each project has four foundation fields:

- Project name, required.
- Game genres, optional multi-value tags with presets and custom values.
- Design philosophies, optional multi-value tags with presets and custom values.
- Description, optional free text.

The project form reuses the Game Design System Foundation genre and philosophy presets, tag interaction, and normalization behavior. Projects and Game Design Systems do not share stored records or lifecycle behavior.

The GDS `Suitable for` field is not included because its meaning overlaps with game genres and is unclear for a concrete game project.

## Validation and Normalization

- Project name remains required and keeps the existing invalid-character validation.
- No project foundation field has a character-count limit.
- Genres and design philosophies each allow at most 20 tags.
- Before storage, tags are trimmed, internal whitespace is collapsed, preset spelling is canonicalized, and case-insensitive duplicates are removed.
- Empty optional values are stored as empty arrays or `null` for the description.

## Data Model and Compatibility

Add two columns to `public.projects`:

- `genres text[] not null default '{}'::text[]`
- `design_philosophies text[] not null default '{}'::text[]`

The existing `description` column continues to store the project description.

Add a transactional project-creation RPC that accepts all four foundation fields and creates both the project and its default Resources folder. Keep the existing project-creation RPC available so existing Agent and other callers remain compatible. Both paths rely on the new column defaults when optional foundation tags are absent.

All collaborators who can read a project can read its foundation fields. Only project administrators can change them, matching the current project-settings permission model.

## Shared UI

Extract the GDS genre presets, design-philosophy presets, and reusable tag selector from the current GDS creation page. The shared selector owns:

- preset selection;
- custom-tag entry;
- canonical preset spelling;
- case-insensitive deduplication;
- whitespace normalization; and
- the 20-tag limit.

The GDS workflow continues to behave as it does today after the extraction. Project-specific layout and labels remain in the project components.

## Create Project Flow

Expand the Create Project dialog into a Foundation form containing project name, game genres, design philosophies, and description.

On submit:

1. Validate and normalize the form.
2. Call the new transactional creation RPC.
3. Receive the new project ID and default Resources folder ID.
4. Insert the complete project into the project-list cache and invalidate the project, folder, and Library-tree queries that depend on it.
5. Select the new project and navigate to its Recent page.

The Library project selector must show the new project immediately, and the Library tree must load the default Resources folder without a page reload. If creation fails, the transaction leaves no partial project or folder, the entered form data remains intact, and the dialog displays the error.

## Settings as the Single Edit Entry

Settings > Profile displays all four foundation fields. Administrators edit them in one form and save them atomically. Collaborators without admin permission see the values in a read-only state.

The form tracks whether values changed and disables Save when there is nothing to persist. On failure, it keeps the draft and reports the error. On success, it updates or invalidates every project cache used by Settings, breadcrumbs, the Library project selector, and other project-aware views.

Remove the separate Edit Project modal and sidebar double-click rename behavior. If an Edit Project context-menu action remains, it navigates to Settings rather than opening another editor.

## Error Handling

- A failed creation RPC does not leave a project without its Resources folder.
- A failed Settings save leaves the persisted project unchanged and retains the user's draft.
- Permission failures produce a clear read-only state or save error rather than silently dropping changes.
- Cache invalidation failures are logged and retried by the normal query lifecycle; persisted success is not reported as a form failure.

## Testing

Unit and component coverage will verify:

- tag normalization, canonicalization, case-insensitive deduplication, and the 20-tag limit;
- project creation submits all four fields;
- creation errors retain the form values;
- Settings loads and saves the four fields;
- non-admin Settings is read-only;
- successful saves refresh all relevant project caches;
- the extracted shared selector does not regress the GDS Foundation flow; and
- the sidebar no longer provides an independent rename or edit-modal path.

An end-to-end flow will verify:

1. Create a project with genres, philosophies, and a description.
2. Confirm it immediately appears in the Library project selector.
3. Confirm its default Resources folder appears in the Library tree.
4. Edit all project information from Settings.
5. Confirm Settings, breadcrumbs, and the Library selector reflect the saved changes without a full reload.

## Out of Scope

- Document simplification or changes to Document resources.
- Target or release platforms.
- The GDS `Suitable for` field.
- Binding a project to a Game Design System record.
- Changing the GDS versioning or generation lifecycle.
