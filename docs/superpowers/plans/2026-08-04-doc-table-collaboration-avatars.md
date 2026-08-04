# Doc and Table Collaboration Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide collaboration avatars for solo sessions and show the local user plus remote users for active multi-user table and document sessions.

**Architecture:** Keep Supabase presence and document Awareness payloads unchanged. Add one small generic display helper that returns an empty list for no remote users and prepends the local display user for a multi-user session; consume it from the existing library, asset, and document header render paths.

**Tech Stack:** React, TypeScript, Jest, Ant Design Avatar/Tooltip, Supabase presence, Yjs Awareness.

---

### Task 1: Add the display-list contract and failing tests

**Files:**
- Create: `src/components/collaboration/collaborationAvatarDisplay.ts`
- Create: `tests/unit/collaboration/collaboration-avatar-display.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { prependLocalUserWhenCollaborating } from '@/components/collaboration/collaborationAvatarDisplay';

describe('collaboration avatar display list', () => {
  const local = { userId: 'local', userName: 'Local' };
  const remote = { userId: 'remote', userName: 'Remote' };

  it('hides the list when there are no remote users', () => {
    expect(prependLocalUserWhenCollaborating([], local)).toEqual([]);
  });

  it('prepends the local user when someone else is present', () => {
    expect(prependLocalUserWhenCollaborating([remote], local)).toEqual([local, remote]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/unit/collaboration/collaboration-avatar-display.test.ts`

Expected: FAIL because the helper module does not exist yet.

- [x] **Step 3: Write the minimal implementation**

```ts
export function prependLocalUserWhenCollaborating<T>(
  remoteUsers: readonly T[],
  localUser: T,
): T[] {
  return remoteUsers.length === 0 ? [] : [localUser, ...remoteUsers];
}
```

- [x] **Step 4: Run the focused test**

Run: `npx jest --runInBand tests/unit/collaboration/collaboration-avatar-display.test.ts`

Expected: PASS.

### Task 2: Apply the solo/multi-user rule to table and asset headers

**Files:**
- Modify: `src/components/libraries/LibraryHeader.tsx`
- Modify: `src/components/asset/AssetHeader.tsx`
- Test: `tests/unit/collaboration/collaboration-avatar-display.test.ts`

- [x] **Step 1: Extend the failing test**

Add representative `PresenceState` objects and assert that each header's display derivation uses the shared helper: an empty remote list yields no avatars, while one remote user yields local first and remote second.

- [x] **Step 2: Run the focused test to verify the new assertions fail**

Run: `npx jest --runInBand tests/unit/collaboration/collaboration-avatar-display.test.ts`

Expected: FAIL against the current header derivation, which always adds the local user.

- [x] **Step 3: Implement the minimal header changes**

Import `prependLocalUserWhenCollaborating`. In `LibraryHeader`, sort remote users first, build the local display object once, and derive `sortedPresenceUsers` from the helper so it is empty when `presenceSource` is empty. In `AssetHeader`, apply the same helper after filtering by `assetId`; retain the existing current-user-first sorting and two-avatar cap. Render the members avatar section only when the derived list is non-empty.

- [x] **Step 4: Run the focused tests**

Run: `npx jest --runInBand tests/unit/collaboration/collaboration-avatar-display.test.ts`

Expected: PASS with solo hidden and multi-user local-first behavior covered.

### Task 3: Add the local avatar to document collaboration display

**Files:**
- Modify: `src/components/documents/DocumentEditor.tsx`
- Modify: `src/components/documents/DocumentEditor.module.css`
- Test: `tests/unit/documents/document-collaboration-wiring.test.ts`

- [x] **Step 1: Write the failing test**

Add a pure display-list test for a document session: no remote collaborators returns `[]`; one remote collaborator returns the local `{ id, name, color }` followed by the remote user; six remote collaborators cap visible avatars at five and expose the correct overflow count.

- [x] **Step 2: Run the test to verify it fails**

Run: `npx jest --runInBand tests/unit/documents/document-collaboration-wiring.test.ts`

Expected: FAIL because `DocumentEditor` does not expose a local-inclusive display derivation.

- [x] **Step 3: Implement the document display derivation and markup**

Export a small pure helper from `DocumentEditor.tsx` that accepts the current user and remote collaborators, returns an empty list for no remote collaborators, otherwise prepends the current user, slices five visible users, and returns the overflow count. Render the existing status/avatar strip from that helper, give it `aria-label="Collaborators currently viewing"`, and retain remote editing titles while labeling the local avatar as viewing. Add only the CSS needed to keep the existing 24px stack stable.

- [x] **Step 4: Run focused document tests**

Run: `npx jest --runInBand tests/unit/documents/document-collaboration-wiring.test.ts tests/unit/documents/document-editor-export.test.tsx`

Expected: PASS, including the existing remote-avatar behavior.

### Task 4: Verify the complete change

**Files:**
- Test: `tests/unit/collaboration/collaboration-avatar-display.test.ts`
- Test: `tests/unit/documents/document-collaboration-wiring.test.ts`
- Modify: `src/components/collaboration/collaborationAvatarDisplay.ts`
- Modify: `src/components/libraries/LibraryHeader.tsx`
- Modify: `src/components/asset/AssetHeader.tsx`
- Modify: `src/components/documents/DocumentEditor.tsx`
- Modify: `src/components/documents/DocumentEditor.module.css`

- [x] **Step 1: Run all affected unit tests**

Run: `npx jest --runInBand tests/unit/collaboration/collaboration-avatar-display.test.ts tests/unit/documents/document-collaboration-wiring.test.ts tests/unit/documents/document-editor-export.test.tsx`

Expected: PASS with zero failing tests.

- [x] **Step 2: Run TypeScript validation**

Run: `npm run typecheck`

Expected: exit code 0.

- [x] **Step 3: Inspect the diff and preserve unrelated worktree changes**

Run: `git diff -- src/components/collaboration/collaborationAvatarDisplay.ts src/components/libraries/LibraryHeader.tsx src/components/asset/AssetHeader.tsx src/components/documents/DocumentEditor.tsx src/components/documents/DocumentEditor.module.css tests/unit/collaboration/collaboration-avatar-display.test.ts tests/unit/documents/document-collaboration-wiring.test.ts`

Expected: only the collaboration avatar behavior and focused tests are changed; unrelated pre-existing modifications remain untouched.
