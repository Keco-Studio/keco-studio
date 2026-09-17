# Conditional Assets Navigation Design

## Goal

Keep the project sidebar focused by showing the `Assets` workspace only after a user explicitly creates or uses it, while preserving a clear path to the first upload.

## User Flow

1. A newly created project does not show `Assets` in its sidebar.
2. The project-level `+` menu includes `Create Asset`.
3. Selecting `Create Asset` opens the existing Assets workspace. The workspace retains its own `Upload` control; `Create Asset` does not upload a file itself.
4. Opening the workspace activates Assets for that project. The sidebar then shows `Assets`, including when it is empty, so users can return to upload and manage resources.
5. Existing projects that already contain any aggregated project game asset show `Assets` automatically. Direct navigation to the workspace also activates it.

## Architecture

Persist an explicit per-project Assets-workspace activation flag, rather than inferring visibility only from asset rows. This makes an empty but intentionally created workspace navigable and avoids an expensive aggregate-assets request on every sidebar render.

The sidebar reads the flag with the project metadata already loaded for the active project. Its tree builder includes the fixed Assets node only when the workspace is active or the current route is the Assets workspace. The project creation menu activates the workspace before navigating. The Assets page also activates the workspace on load, which supports direct URLs and existing links.

## Data And Compatibility

- Add a non-null `assets_workspace_enabled` boolean column to `projects`, defaulting to `false`.
- Backfill the flag to `true` for projects that already have manual, map, or character project assets.
- Expose a project-scoped authenticated endpoint or service mutation that enables the flag. It is idempotent and requires existing project write permission.
- Do not hide the workspace again after the last asset is deleted; activation represents a user's choice to have an Assets workspace.

## UI

- Add `Create Asset` to the project-level create menu only. Its label describes entering/creating the workspace, not uploading a file.
- Preserve the existing `Upload` control on the Assets page as the file-upload action.
- Do not add a new modal or duplicate uploader.

## Verification

- Unit-test the sidebar tree with an inactive project, an active empty workspace, and the Assets route.
- Test the create-menu action activates the workspace and navigates to the existing Assets URL.
- Test the activation endpoint's authorization and idempotence.
- Run relevant unit tests, typecheck, and lint before completion.
