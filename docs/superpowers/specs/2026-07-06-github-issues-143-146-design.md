# GitHub Issues 143-146 Fix Spec

## Context

Repository: `Keco-Studio/keco-studio`

Issues covered:

- #143: `library_field_definitions` RLS permits any authenticated user.
- #144: Agent chat auto-executes write/meta/post-preview tools by default.
- #145: CI runs build only and skips lint/unit tests.
- #146: App routes lack Next.js error/loading/not-found boundaries.

## Root Cause Findings

### Issue #143

`supabase/migrations/20251216100000_create_library_field_definitions_base.sql` creates `lfd_select_auth`, `lfd_insert_auth`, `lfd_update_auth`, and `lfd_delete_auth` with `using (true)` or `with check (true)` for authenticated users. Since each field definition points to a library and each library belongs to a project, the policy must scope through `libraries.project_id`.

Existing secure sibling pattern:

- `library_assets_select_policy`: project owner or accepted collaborator can read.
- `library_assets_insert_policy`, `library_assets_update_policy`, `library_assets_delete_policy`: project owner or accepted `admin`/`editor` collaborator can write.

### Issue #144

`src/app/api/agent-chat/route.ts` uses `true` when the request body omits `autoExecute`.

`src/components/agent/useAgentChat.ts` initializes client state as `true`.

`src/lib/agent/conversation-meta.ts` resolves missing meta to `autoExecute: true`, and `needsConfirmation` returns `false` for every write tool before checking `confirmationMode`. That bypasses `post_preview` and `meta` tools.

### Issue #145

`.github/workflows/ci.yml` only runs `npm run build`. `package.json` currently defines `validate` as `npm run lint && npm run build`, which also does not run unit tests. The lint command itself is known broken under Next 16 in #163, so this fix should wire CI to the desired gates without broadening into the separate lint modernization issue.

### Issue #146

`src/app` has no `error.tsx`, `loading.tsx`, or `not-found.tsx` route convention files. The most stateful dashboard routes therefore have no route-level containment if rendering or data loading throws.

## Requirements

- Code, comments, identifiers, and API names stay in English.
- User-facing final replies stay in Chinese.
- Preserve unrelated user changes, especially the existing local edit in `src/components/layout/Sidebar.tsx`.
- Use TDD for code behavior changes where the project has a practical test surface.
- Keep fixes scoped to issues #143-#146.
- Do not solve #163 except as needed to avoid making #145 depend on a broken `validate` script.

## Target Behavior

### Issue #143

`library_field_definitions` policies must:

- Allow `SELECT` when the user is the project owner or an accepted collaborator on the parent project.
- Allow `INSERT`, `UPDATE`, and `DELETE` when the user is the project owner or an accepted collaborator with role `admin` or `editor` on the parent project.
- Deny authenticated users with no access to the parent project.
- Deny accepted `viewer` collaborators from mutating schema rows.
- Be enforced in final database state via a new forward migration.
- Avoid reintroducing permissive policies in the base migration used by clean resets.

### Issue #144

Agent confirmation behavior must:

- Default missing conversation meta to `autoExecute: false`.
- Default new server-side conversations to `autoExecute: false` when the request omits it.
- Default client-side chat state to confirm mode.
- Always require confirmation for `confirmationMode: 'post_preview'` and `confirmationMode: 'meta'` write tools.
- Continue to let read tools skip confirmation.
- Permit explicit `autoExecute: true` to skip confirmation only for `pre_execute` write tools.
- Preserve legacy `skipConfirmation: true` only for `pre_execute` write tools, and only when no explicit `autoExecute: false` is set.

### Issue #145

CI must:

- Run lint.
- Run unit tests.
- Run build.
- Use existing Supabase setup/reset before build.
- Keep the final cleanup step.
- Expose the gate through `npm run validate` so local and CI expectations match.

### Issue #146

Route boundaries must:

- Add a root app `error.tsx` backstop.
- Add root app `loading.tsx` and `not-found.tsx`.
- Add dashboard project-level boundaries under `src/app/(dashboard)/[projectId]`.
- Add library-level boundaries under `src/app/(dashboard)/[projectId]/[libraryId]`.
- Add asset-level boundaries under `src/app/(dashboard)/[projectId]/[libraryId]/[assetId]`.
- Use accessible, minimal UI that fits the app's current layout without adding new dependencies.
- Keep `error.tsx` files as client components and provide a retry button through `reset()`.

## Verification Strategy

- Unit tests for `resolveConversationMeta` and `needsConfirmation`.
- Static unit test for `library_field_definitions` RLS migration content.
- Static unit test for CI workflow gates.
- Static unit test for route boundary file presence and required boundary behavior markers.
- Targeted Jest runs for new/changed tests.
- Final `npm run test:unit -- --runInBand` if practical.

