# Game Design System Direct Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the personal-system `Copy and edit` workflow with a direct document-edit action while keeping official presets read-only.

**Architecture:** `GameDesignSystemWorkspace` owns document-edit state so its header can switch to Overview and open the existing editor directly. Saving continues through the existing immutable version endpoint on the same system; copy APIs and persistence remain unchanged but are no longer called by this workspace.

**Tech Stack:** React 19, TypeScript, TanStack Query, Testing Library, Jest

## Global Constraints

- Do not use TDD; implement the approved behavior first, then update focused coverage.
- Personal-system saves create a new immutable version in the same system.
- Official presets expose no edit, copy, or delete actions.
- Keep the existing copy API and service functions for compatibility.
- Do not modify unrelated files or existing user changes.

---

### Task 1: Direct Personal-System Document Editing

**Files:**
- Modify: `src/components/game-design-system/GameDesignSystemWorkspace.tsx:1-425`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.tsx:112-123`
- Test: `src/components/game-design-system/GameDesignSystemsPage.test.tsx`

**Interfaces:**
- Consumes: existing `GameDesignSystemDocumentEditor`, `createGameDesignSystemVersion(id, rules, parentVersionId, document)`, and `owned` permission calculation.
- Produces: workspace-owned `editingDocument: boolean`; personal header action `Edit document`; controlled Overview editor callbacks.

- [ ] **Step 1: Make the Overview document editor controlled by the workspace**

In `GameDesignSystemWorkspace.tsx`, remove `CopyOutlined` and
`copyGameDesignSystemDraft` imports. Replace Overview's local editing state with
controlled props:

```tsx
function OverviewView(props: {
  detail: GameDesignSystemDetail;
  version: GameDesignSystemVersion | null;
  editing: boolean;
  pending: boolean;
  onCancelEditing: () => void;
  onCreateVersion: (document: GameDesignDocument) => Promise<void>;
}) {
  if (!props.version) return <div className={styles.workspaceState}>This system has no available versions.</div>;
  if (props.editing) {
    return <GameDesignSystemDocumentEditor
      base={props.version.document}
      pending={props.pending}
      onCancel={props.onCancelEditing}
      onSave={props.onCreateVersion}
    />;
  }
}
```

After this early editor return, retain the existing readable document markup
from `<section className={styles.documentView}>` onward, deleting only its
owner-only `Edit design document` button because the header becomes the single
edit entry point.

- [ ] **Step 2: Replace the workspace copy action with direct editing**

Add workspace-owned state and remove `canCopy`, `copyMutation`, and
`copyMutation.isPending` from `busy`:

```tsx
const [editingDocument, setEditingDocument] = useState(false);
const owned = detail.source === 'user' && detail.owner_id === props.viewerUserId;
const busy = metadataMutation.isPending || versionMutation.isPending || deleteMutation.isPending;
```

Render the personal header action and keep official headers mutation-free:

```tsx
{owned ? (
  <button
    className={styles.secondaryButton}
    type="button"
    aria-label="Edit document"
    disabled={busy}
    onClick={() => {
      setView('overview');
      setEditingDocument(true);
    }}
  >
    <EditOutlined /> Edit document
  </button>
) : null}
```

Pass controlled state into Overview and close the editor only after a successful
save or explicit cancel:

```tsx
{view === 'overview' ? (
  <OverviewView
    key={selectedVersion?.id ?? 'no-version'}
    detail={detail}
    version={selectedVersion}
    editing={editingDocument}
    pending={versionMutation.isPending}
    onCancelEditing={() => setEditingDocument(false)}
    onCreateVersion={async (document) => {
      await versionMutation.mutateAsync({ rules: selectedVersion!.rules, document });
      setEditingDocument(false);
    }}
  />
) : null}
```

- [ ] **Step 3: Remove the obsolete copy-selection callback**

Delete `onSelectedCopy` from `GameDesignSystemWorkspace`'s `Props` type and
remove this prop from `GameDesignSystemsPage.tsx`:

```tsx
<GameDesignSystemWorkspace
  key={detailQuery.data.id}
  detail={detailQuery.data}
  viewerUserId={viewerUserId}
  projects={projectsQuery.data ?? []}
  projectsLoading={projectsQuery.isLoading}
  projectsError={projectsQuery.isError}
  onRetryProjects={() => void projectsQuery.refetch()}
  onDeleted={() => setSelectedId(null)}
/>
```

- [ ] **Step 4: Update focused behavior coverage after implementation**

In `GameDesignSystemsPage.test.tsx`, update the document-edit test so it first
opens `Rules`, clicks the header action, and proves the action returns to
Overview and opens the editor without copying:

```tsx
await screen.findByRole('heading', { name: 'Design document' });
await user.click(screen.getByRole('tab', { name: 'Rules' }));
await user.click(screen.getByRole('button', { name: 'Edit document' }));
expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
expect(screen.getByLabelText('Design intent')).toBeTruthy();
expect(screen.queryByRole('button', { name: 'Copy and edit' })).toBeNull();
```

Add this official-preset case:

```tsx
it('keeps official presets read-only', async () => {
  const user = userEvent.setup();
  const official = {
    ...system,
    id: 'official-system',
    owner_id: null,
    source: 'official',
    title: 'Official Tactical Rules',
  };
  const officialVersion = { ...version, system_id: official.id };
  fetchSystems.mockResolvedValue([official]);
  fetchDetail.mockResolvedValue({
    ...official,
    current_version: officialVersion,
    versions: [officialVersion],
  });

  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);
  await user.click(await screen.findByRole('tab', { name: /Official/ }));
  expect(await screen.findByRole('heading', { name: 'Design document' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Edit details' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit document' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Copy and edit' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Delete system' })).toBeNull();
});
```

- [ ] **Step 5: Run focused verification**

Run:

```bash
npx jest src/components/game-design-system/GameDesignSystemsPage.test.tsx --runInBand
npx eslint src/components/game-design-system/GameDesignSystemWorkspace.tsx src/components/game-design-system/GameDesignSystemsPage.tsx src/components/game-design-system/GameDesignSystemsPage.test.tsx
npm run typecheck
```

Expected: the focused Jest suite passes, ESLint reports no errors in the changed
files, and TypeScript exits successfully.

- [ ] **Step 6: Commit the implementation**

```bash
git add src/components/game-design-system/GameDesignSystemWorkspace.tsx \
  src/components/game-design-system/GameDesignSystemsPage.tsx \
  src/components/game-design-system/GameDesignSystemsPage.test.tsx
git commit -m "fix: edit personal game systems directly"
```
