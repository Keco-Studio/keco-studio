# Document Resource References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add compact inline references from a document to a specific table row/display field or a specific heading/paragraph in another current-project document.

**Architecture:** Store references as sanctioned inline `ResourceReference` MDX nodes in the existing Lexical/Yjs content. Persist heading and paragraph identity with Lexical `NodeState`, serialized as a sanctioned `BlockAnchor` by custom MDX visitors. Resolve labels through caller-scoped Supabase queries and existing RLS; do not add a reference relationship table.

**Tech Stack:** Next.js 16, React 19, TypeScript, MDXEditor 4, Lexical NodeState, Yjs, Supabase, TanStack Query, Ant Design, Jest, Playwright.

---

## File Map

- `src/lib/documents/resourceReferenceTypes.ts`: semantic targets, keys, and MDX attributes.
- `src/lib/documents/documentBlockIdentity.ts`: NodeState, normalization, block listing, MDX visitors.
- `src/components/documents/documentBlockIdentityPlugin.ts`: Realm registration and DOM markers.
- `src/lib/documents/documentReferenceBlocks.ts`: durable normalization for legacy states.
- `src/lib/documents/resourceReferenceService.ts`: source loading and batched target resolution.
- `src/components/documents/ResourceReferenceProvider.tsx`: mounted-target batching and invalidation.
- `src/components/documents/ResourceReferenceEditor.tsx`: inline atomic reference rendering.
- `src/components/documents/ResourceReferencePickerModal.tsx`: Table/Document selection workflow.
- `src/components/documents/useReferencedDocumentBlock.ts`: block hash navigation/highlight.
- Existing sanctioned MDX, codec, editor, gateway, export, Agent-read, and asset-detail files are extended at their current boundaries.

### Task 1: Define the Safe Reference Schema

**Files:**
- Create: `src/lib/documents/resourceReferenceTypes.ts`
- Modify: `src/lib/documents/sanctionedMdx.ts`
- Modify: `src/lib/documents/sanctionedMdxDescriptors.tsx`
- Test: `src/lib/documents/sanctionedMdx.test.ts`

- [ ] **Step 1: Write failing validation tests**

Add accepted examples for:

```mdx
# <BlockAnchor id="66666666-6666-4666-8666-666666666666" />Heading

See <ResourceReference kind="table-row" libraryId="11111111-1111-4111-8111-111111111111" assetId="22222222-2222-4222-8222-222222222222" displayFieldId="33333333-3333-4333-8333-333333333333" fallbackLabel="Ada" />.

See <ResourceReference kind="document-block" documentId="44444444-4444-4444-8444-444444444444" blockId="55555555-5555-4555-8555-555555555555" blockType="paragraph" fallbackLabel="The city closes its gates" />.
```

Add rejection cases for invalid UUIDs, expression properties, event handlers, children, a table kind with document properties, and a document kind with table properties.

- [ ] **Step 2: Verify tests fail**

Run:

```bash
npm run test:unit -- src/lib/documents/sanctionedMdx.test.ts --runInBand
```

Expected: FAIL because both component names are unsupported.

- [ ] **Step 3: Implement target parsing and serialization**

Create these exact exports:

```ts
export type TableRowReferenceTarget = {
  kind: 'table-row';
  libraryId: string;
  assetId: string;
  displayFieldId: string;
  fallbackLabel: string;
};

export type DocumentBlockReferenceTarget = {
  kind: 'document-block';
  documentId: string;
  blockId: string;
  blockType: 'heading' | 'paragraph';
  fallbackLabel: string;
};

export type ResourceReferenceTarget =
  | TableRowReferenceTarget
  | DocumentBlockReferenceTarget;

export function resourceReferenceKey(target: ResourceReferenceTarget): string;
export function parseResourceReferenceAttributes(
  attributes: Readonly<Record<string, string>>
): ResourceReferenceTarget | null;
export function resourceReferenceAttributes(
  target: ResourceReferenceTarget
): Record<string, string>;
```

Use `isUuid`; reject blank fallback labels and every property set that does not exactly match its kind.

- [ ] **Step 4: Extend the sanctioned component registry**

Allow registry entries to declare `kind: 'flow' | 'text'` and `hasChildren: boolean`. Add `BlockAnchor` as a childless text component with UUID `id`; add `ResourceReference` as a childless text component with the fixed properties above. In `validateJsxNode`, parse `ResourceReference` through `parseResourceReferenceAttributes` and keep expressions, spreads, arbitrary URLs, and unknown JSX rejected.

Update `createSanctionedMdxDescriptors` to use each entry's actual `kind` and `hasChildren`.

- [ ] **Step 5: Run focused tests**

```bash
npm run test:unit -- src/lib/documents/sanctionedMdx.test.ts tests/unit/documents/sanctioned-mdx-editor-wiring.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/documents/resourceReferenceTypes.ts src/lib/documents/sanctionedMdx.ts src/lib/documents/sanctionedMdxDescriptors.tsx src/lib/documents/sanctionedMdx.test.ts
git commit -m "feat: define document resource reference schema"
```

### Task 2: Persist Stable Block IDs in Lexical, Yjs, and MDX

**Files:**
- Create: `src/lib/documents/documentBlockIdentity.ts`
- Create: `src/components/documents/documentBlockIdentityPlugin.ts`
- Modify: `src/lib/documents/headlessDocumentNodes.ts`
- Modify: `src/components/documents/MdxDocumentEditor.tsx`
- Test: `tests/unit/documents/document-block-identity.test.ts`
- Test: `tests/unit/documents/document-content-codec.test.ts`

- [ ] **Step 1: Write failing round-trip tests**

For `# Heading\n\nParagraph`, assert the codec emits two distinct UUID `BlockAnchor` nodes and a second round trip keeps both IDs. Add a duplicate-ID input and assert the first block keeps its ID while the copied block receives a fresh ID.

Add editor-level cases for text edits, moving a whole block, splitting, merging, copying, and deleting: edits/moves retain the original ID; split keeps the leading ID; merge keeps the destination ID; copy receives a fresh ID; delete removes the target ID.

- [ ] **Step 2: Verify failure**

```bash
npm run test:unit -- tests/unit/documents/document-block-identity.test.ts --runInBand
```

Expected: FAIL because no block identity plugin exists.

- [ ] **Step 3: Implement NodeState and block listing**

Define:

```ts
export const documentBlockIdState = createState('kecoBlockId', {
  parse: (value) => typeof value === 'string' && isUuid(value) ? value : '',
});

export type DocumentReferenceBlock = {
  blockId: string;
  blockType: 'heading' | 'paragraph';
  text: string;
  headingLevel?: number;
  nearestHeading?: string;
};

export function normalizeDocumentBlockIds(): void;
export function listDocumentReferenceBlocks(): DocumentReferenceBlock[];
```

Walk unique top-level paragraph/heading nodes in order. Keep the first valid ID, replace missing or duplicate IDs with `crypto.randomUUID()`, and collapse displayed text whitespace. Splits/copies naturally duplicate NodeState; normalization preserves the leading occurrence and regenerates later duplicates.

- [ ] **Step 4: Add high-priority MDX visitors**

Export paragraph and heading import/export visitors with priority `100`. Export visitors prepend this MDAST child:

```ts
{
  type: 'mdxJsxTextElement',
  name: 'BlockAnchor',
  attributes: [{ type: 'mdxJsxAttribute', name: 'id', value: blockId }],
  children: [],
}
```

Import visitors remove the leading anchor from content, create the normal paragraph/heading node, set NodeState, and visit the remaining children. `BlockAnchor` therefore persists in Markdown but never renders as editable content.

- [ ] **Step 5: Register editor transforms and DOM markers**

Create `documentBlockIdentityPlugin({ assignMissingIds })`. Publish the visitors with `addImportVisitor$`/`addExportVisitor$`; register paragraph and heading transforms when `assignMissingIds` is true. Add an update listener that sets:

```ts
element.dataset.documentBlockId = blockId;
element.dataset.documentBlockType = blockType;
```

Browser editors pass `assignMissingIds: !readOnly`. Headless editors register visitors with assignment disabled and expose explicit `normalizeBlockIds()` and `listReferenceBlocks()` methods.

- [ ] **Step 6: Wire browser and headless paths**

Add the plugin before collaboration in `MdxDocumentEditor`. Add it to `headlessDocumentNodes.documentPlugins()`. In `markdownToYjsState`, call `normalizeBlockIds()` after `setMarkdown()` and before encoding Yjs.

- [ ] **Step 7: Run regression tests**

```bash
npm run test:unit -- tests/unit/documents/document-block-identity.test.ts tests/unit/documents/document-content-codec.test.ts tests/unit/documents/document-collaboration-session.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/documents/documentBlockIdentity.ts src/components/documents/documentBlockIdentityPlugin.ts src/lib/documents/headlessDocumentNodes.ts src/components/documents/MdxDocumentEditor.tsx tests/unit/documents/document-block-identity.test.ts tests/unit/documents/document-content-codec.test.ts
git commit -m "feat: persist stable document block identities"
```

### Task 3: Make Legacy Block Normalization Durable

**Files:**
- Modify: `src/lib/documents/documentContentCodec.ts`
- Modify: `src/lib/documents/documentStateGateway.ts`
- Create: `src/lib/documents/documentReferenceBlocks.ts`
- Modify: `src/lib/documents/documentCollaborationProtocol.ts`
- Modify: `src/lib/documents/documentCollaborationSession.ts`
- Modify: `src/lib/documents/documentStateResetBroadcaster.ts`
- Create: `supabase/migrations/20260717000000_document_block_normalization.sql`
- Modify: `tests/helpers/documentCodecProbe.ts`
- Test: `tests/unit/documents/document-reference-blocks.test.ts`

- [ ] **Step 1: Write a failing idempotence test**

Add codec probe mode `normalize-blocks`. The first normalization of anchor-free Yjs must return a non-empty delta and two blocks; applying that delta and normalizing again must return `null`.

- [ ] **Step 2: Extend the codec contract**

Add:

```ts
normalizeYjsState(
  snapshotBase64: string | null,
  updateTailBase64: readonly string[]
): Promise<{
  yjsStateBase64: string;
  markdown: string;
  normalizationUpdateBase64: string | null;
  blocks: DocumentReferenceBlock[];
}>;
```

Hydrate the bound headless editor, capture `Y.encodeStateVector(doc)`, run explicit block normalization, wait for Lexical/Yjs sync, then encode the delta and full state. Treat the canonical empty Yjs update as `null`. Make `yjsStateToMarkdown` delegate to this method.

- [ ] **Step 3: Persist normalized state through an epoch-fenced RPC**

Replace the pre-normalized `merged` arguments in `compactDocumentState` with:

```ts
const normalized = await documentContentCodec.normalizeYjsState(
  head.yjs_state,
  tail.map((row) => row.update_data)
);
```

Pass `normalized.yjsStateBase64` and `normalized.markdown` to a caller-scoped normalization RPC. Under a document-row lock, the RPC must validate the expected epoch and revision plus exact current update-tail IDs, validate the snapshot payload, write the normalized state and Markdown, increment the collaboration epoch and revision, delete the old-epoch tail, and return the committed state. This fences pending updates from editors hydrated against the old epoch.

- [ ] **Step 4: Add caller-scoped atomic ensure/list behavior**

Implement:

```ts
export async function ensureDocumentReferenceBlocks(
  client: SupabaseClient,
  documentId: string
): Promise<{ projectId: string; blocks: DocumentReferenceBlock[] }>;
```

Read transport state and normalize it. When no normalization update is needed, return the current blocks without writing. Otherwise persist the normalized full Yjs state and matching Markdown through the epoch-fenced normalization RPC. Broadcast the returned epoch/revision/state with reset reason `normalization`, then decode the RPC-committed state before returning blocks. If another normalizer wins, retry the whole read/normalize/commit flow once on `DocumentStateConflictError` and return only the winner's committed IDs. Reject uninitialized legacy state instead of adding an LWW write path. Old-epoch editor appends must fail with `PT409` and reload/rebase through the existing collaboration-session path.

- [ ] **Step 5: Run tests**

```bash
npm run test:unit -- tests/unit/documents/document-content-codec.test.ts tests/unit/documents/document-reference-blocks.test.ts tests/unit/documents/document-state-gateway.test.ts --runInBand
```

Expected: PASS and normalization is idempotent.

- [ ] **Step 6: Commit**

```bash
git add src/lib/documents/documentContentCodec.ts src/lib/documents/documentStateGateway.ts src/lib/documents/documentReferenceBlocks.ts tests/helpers/documentCodecProbe.ts tests/unit/documents/document-reference-blocks.test.ts tests/unit/documents/document-content-codec.test.ts
git commit -m "feat: normalize document block ids durably"
```

### Task 4: Build the Project-Scoped Resolver and Picker Data Loaders

**Files:**
- Create: `src/lib/documents/resourceReferenceService.ts`
- Test: `tests/unit/documents/resource-reference-service.test.ts`
- Test: `tests/unit/database/document-resource-references.rls.behavior.test.ts`

- [ ] **Step 1: Write failing available/unavailable tests**

Assert a valid table target resolves to label `Active`, context `Characters / Ada / Status`, and `/${projectId}/${libraryId}/${assetId}?field=${fieldId}`. Assert a document block resolves to its current text, document/heading context, and `/${projectId}/doc/${documentId}#block-${blockId}`. Cross-project, mismatched, deleted, and RLS-hidden targets all resolve to one unavailable shape.

- [ ] **Step 2: Define the resolver contract**

```ts
export type ResolvedResourceReference = {
  key: string;
  status: 'available' | 'unavailable';
  label: string;
  contextLabel?: string;
  href?: string;
};

export async function resolveResourceReferences(
  client: SupabaseClient,
  projectId: string,
  targets: readonly ResourceReferenceTarget[]
): Promise<Map<string, ResolvedResourceReference>>;
```

Deduplicate targets by key. Batch-query `libraries`, `library_assets`, `library_field_definitions`, and `library_asset_values`. Require every table relationship and project ID to match. Use `cellDisplayString`; represent an existing empty field as `(empty)`.

For documents, read each unique document once through `documentStateGateway.read`, require the current project, extract blocks, and catch `DocumentAccessError` as unavailable without leaking its cause.

- [ ] **Step 3: Add picker loaders**

Export:

```ts
listTableReferenceSources(client, projectId);
listTableReferenceRows(client, libraryId);
listDocumentReferenceSources(client, projectId, excludeDocumentId);
listDocumentReferenceBlocks(client, projectId, documentId);
```

The block loader calls `ensureDocumentReferenceBlocks` and rejects a project mismatch. The table row loader returns ordered fields and `Record<string, unknown>` values per row.

- [ ] **Step 4: Run tests**

```bash
npm run test:unit -- tests/unit/documents/resource-reference-service.test.ts tests/unit/database/document-resource-references.rls.behavior.test.ts --runInBand
```

Expected: PASS for owner/admin/editor/viewer reads; outsider and cross-project targets return the same unavailable result.

- [ ] **Step 5: Commit**

```bash
git add src/lib/documents/resourceReferenceService.ts tests/unit/documents/resource-reference-service.test.ts tests/unit/database/document-resource-references.rls.behavior.test.ts
git commit -m "feat: resolve document resource references"
```

### Task 5: Render and Refresh Inline Reference Labels

**Files:**
- Create: `src/components/documents/ResourceReferenceProvider.tsx`
- Create: `src/components/documents/ResourceReferenceEditor.tsx`
- Modify: `src/components/documents/MdxDocumentEditor.tsx`
- Modify: `src/components/documents/MdxDocumentEditor.module.css`
- Modify: `src/lib/utils/queryKeys.ts`
- Test: `tests/unit/documents/resource-reference-editor.test.tsx`

- [ ] **Step 1: Write failing rendering tests**

Assert loading keeps the fallback label at a stable width, available targets render an internal anchor with table/document icon and full accessible context, unavailable targets render `Reference unavailable` without an `href`, and viewers have no replace/remove controls.

- [ ] **Step 2: Add a stable query key and provider**

Add:

```ts
resourceReferences: (projectId: string, keys: readonly string[]) =>
  ['project', projectId, 'resource-references', ...keys] as const,
```

The provider registers mounted targets, sorts/deduplicates keys, and performs one `resolveResourceReferences` query. Keep previous results during refetch. Subscribe to `subscribeToProjectDocumentUpdates`; invalidate when a referenced document changes. Subscribe to each referenced `library:${libraryId}:edits` channel and invalidate on `cell:update`, `cells:batch-update`, and `asset:delete`; remove unused channels.

- [ ] **Step 3: Implement `ResourceReferenceEditor`**

Parse fixed attributes, register the target, and render:

```tsx
<Tooltip title={`${resolved.contextLabel}: ${resolved.label}`}>
  <a className={styles.resourceReference} href={resolved.href}>
    {target.kind === 'table-row' ? <TableOutlined /> : <FileTextOutlined />}
    <span>{resolved.label}</span>
  </a>
</Tooltip>
```

Use `useMdastNodeUpdater` for replacement. Render a warning span for unavailable targets. In editable mode show icon-only Replace and Remove controls with tooltips; in read-only mode omit them.

- [ ] **Step 4: Add component-specific JSX descriptors**

Keep `Callout`/`Details` on `GenericJsxEditor`, render `BlockAnchor` as `null`, and render `ResourceReference` with the new editor. Pass `projectId`, `documentId`, and `readOnly` into `MdxDocumentEditor`; wrap `MDXEditor` with the provider. Style a fixed 24px inline height, ellipsis, visible focus, and no nested card.

- [ ] **Step 5: Run tests**

```bash
npm run test:unit -- tests/unit/documents/resource-reference-editor.test.tsx tests/unit/documents/sanctioned-mdx-editor-wiring.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/documents/ResourceReferenceProvider.tsx src/components/documents/ResourceReferenceEditor.tsx src/components/documents/MdxDocumentEditor.tsx src/components/documents/MdxDocumentEditor.module.css src/lib/utils/queryKeys.ts tests/unit/documents/resource-reference-editor.test.tsx tests/unit/documents/sanctioned-mdx-editor-wiring.test.ts
git commit -m "feat: render live document resource references"
```

### Task 6: Add Table and Document Picker Workflows

**Files:**
- Create: `src/components/documents/ResourceReferencePickerModal.tsx`
- Create: `src/components/documents/ResourceReferencePickerModal.module.css`
- Modify: `src/components/documents/MdxDocumentEditor.tsx`
- Test: `tests/unit/documents/resource-reference-picker.test.tsx`

- [ ] **Step 1: Write failing interaction tests**

For Table: choose table, row, and display field; assert the emitted target contains `libraryId`, `assetId`, `displayFieldId`, and the current fallback display value. For Document: choose another document and a heading/paragraph; assert `documentId`, `blockId`, `blockType`, and fallback text. Assert the open document is excluded and confirm stays disabled until complete.

- [ ] **Step 2: Implement the modal**

Use Ant Design `Modal`, `Tabs`, `Select`, `Input`, `List`, and `Spin`. Reset row/field when table changes and block when document changes. Search table rows across name plus all cell display strings; search document blocks across text and nearest heading. Render compact list rows, not cards.

- [ ] **Step 3: Wire toolbar insertion**

Add `Insert reference` with a link icon. Preserve selection on `mousedown`. On confirm publish:

```ts
insertJsx({
  kind: 'text',
  name: 'ResourceReference',
  props: resourceReferenceAttributes(target),
});
```

Use the same modal for replacement by passing the selected target and updating the JSX MDAST node through `useMdastNodeUpdater`.

Before insertion or replacement, resolve the selected target once more. If it became unavailable, keep the modal open and render `The selected reference is no longer available.` Restore the editor selection/focus after cancel or successful insertion.

- [ ] **Step 4: Run tests**

```bash
npm run test:unit -- tests/unit/documents/resource-reference-picker.test.tsx tests/unit/documents/resource-reference-editor.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/documents/ResourceReferencePickerModal.tsx src/components/documents/ResourceReferencePickerModal.module.css src/components/documents/MdxDocumentEditor.tsx tests/unit/documents/resource-reference-picker.test.tsx
git commit -m "feat: insert table and document references"
```

### Task 7: Navigate to Referenced Blocks and Fields

**Files:**
- Create: `src/components/documents/useReferencedDocumentBlock.ts`
- Modify: `src/components/documents/DocumentEditor.tsx`
- Modify: `src/components/documents/MdxDocumentEditor.tsx`
- Modify: `src/components/documents/MdxDocumentEditor.module.css`
- Modify: `src/app/(dashboard)/[projectId]/[libraryId]/[assetId]/page.tsx`
- Modify: `src/app/(dashboard)/[projectId]/[libraryId]/[assetId]/page.module.css`
- Test: `tests/unit/documents/document-reference-navigation.test.tsx`

- [ ] **Step 1: Write failing navigation tests**

Given `#block-${blockId}`, assert the document waits for `[data-document-block-id="${blockId}"]`, scrolls it to center, highlights it for two seconds, then removes the class. Assert a missing target shows `Referenced content is unavailable` once. Add the equivalent `?field=${fieldId}` asset-detail expectation.

- [ ] **Step 2: Implement document block navigation**

Observe the editor DOM for at most five seconds after hydration. On match call `scrollIntoView({ block: 'center' })`, add `documentBlockHighlight`, and clean up observer/timer. Preserve the hash for reload and new-tab behavior.

- [ ] **Step 3: Implement table field focus**

Read `field` with `useSearchParams`. Add `data-field-id={f.id}` to every field row. After data renders, scroll, focus the existing control, and add a temporary highlight. If the field is missing, keep the row page open and show the unavailable toast.

- [ ] **Step 4: Run tests**

```bash
npm run test:unit -- tests/unit/documents/document-reference-navigation.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/documents/useReferencedDocumentBlock.ts src/components/documents/DocumentEditor.tsx src/components/documents/MdxDocumentEditor.tsx src/components/documents/MdxDocumentEditor.module.css 'src/app/(dashboard)/[projectId]/[libraryId]/[assetId]/page.tsx' 'src/app/(dashboard)/[projectId]/[libraryId]/[assetId]/page.module.css' tests/unit/documents/document-reference-navigation.test.tsx
git commit -m "feat: navigate to referenced rows and document blocks"
```

### Task 8: Resolve References for Export and Agent Reads

**Files:**
- Create: `src/lib/documents/resourceReferenceMarkdown.ts`
- Modify: `src/lib/documents/documentExportService.ts`
- Modify: `src/app/api/documents/[documentId]/export/route.ts`
- Modify: `src/components/documents/DocumentEditor.tsx`
- Modify: `src/lib/agent/tools/read-document.ts`
- Test: `tests/unit/documents/document-export-service.test.ts`
- Test: `tests/unit/documents/document-export-route.test.ts`
- Test: `tests/unit/agent/document-tools.test.ts`
- Test: `tests/unit/agent/document-edit-operations.test.ts`
- Test: `tests/unit/documents/document-version-service.test.ts`

- [ ] **Step 1: Write failing semantic-output tests**

Assert available references become readable linked text in DOCX/PDF export models. Assert unavailable references become `[Reference unavailable]`. Assert an MDX download preserves `ResourceReference` and `BlockAnchor` nodes. Assert Agent reads contain no raw `<BlockAnchor>` or `ResourceReference` properties before full/outline/heading/line slicing.

- [ ] **Step 2: Implement AST-based plain Markdown resolution**

Export:

```ts
export async function resolveReferencesForPlainMarkdown(
  client: SupabaseClient,
  projectId: string,
  markdown: string
): Promise<string>;
```

Parse validated MDX, collect references, resolve once, remove `BlockAnchor` nodes, and replace `ResourceReference` nodes with text/link MDAST nodes. Serialize through the existing Markdown AST pipeline; do not use regex replacement.

- [ ] **Step 3: Integrate export and Agent reads**

In `exportDocument`, resolve the latest state Markdown before `buildDocumentExportModel`. Keep a defensive `ResourceReference` branch in `astInline` that emits unavailable text when a caller bypasses resolution. In `read-document.ts`, resolve before `readDocumentSlice` so reported line ranges match Agent-visible content.

Extend `DocumentExportFormat` and the export route with `mdx`. For MDX, return the validated authoritative Markdown unchanged as UTF-8 `text/markdown`; add `Download MDX` to the existing compact export menu. This is the semantic round-trip format, while DOCX/PDF use resolved readable labels.

Add Agent edit-operation tests proving `replace_text`, insert, append, and delete preserve untouched `BlockAnchor` nodes. `replace_all` deliberately creates a new document body and therefore receives newly normalized IDs. Add a version-service regression asserting restore keeps exact stored IDs and reference nodes.

- [ ] **Step 4: Run tests**

```bash
npm run test:unit -- tests/unit/documents/document-export-service.test.ts tests/unit/documents/document-export-route.test.ts tests/unit/agent/document-tools.test.ts tests/unit/agent/document-edit-operations.test.ts tests/unit/documents/document-version-service.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/documents/resourceReferenceMarkdown.ts src/lib/documents/documentExportService.ts src/app/api/documents/[documentId]/export/route.ts src/components/documents/DocumentEditor.tsx src/lib/agent/tools/read-document.ts tests/unit/documents/document-export-service.test.ts tests/unit/documents/document-export-route.test.ts tests/unit/agent/document-tools.test.ts tests/unit/agent/document-edit-operations.test.ts tests/unit/documents/document-version-service.test.ts
git commit -m "feat: resolve document references in exports and agent reads"
```

### Task 9: Add Browser Acceptance Coverage

**Files:**
- Create: `tests/e2e/specs/document-references.spec.ts`
- Modify: `tests/e2e/pages/project.page.ts` only for reusable selectors used by this spec

- [ ] **Step 1: Cover table references**

Create a table, fields, row, and document. Insert a row/display-field reference, reload, edit the source value from a second context, focus the document, and assert the label refreshes. Activate it and assert the row route and field highlight.

- [ ] **Step 2: Cover heading and paragraph references**

Create source and referencing documents. Insert one heading and one paragraph reference, edit and move the source blocks, reload, and assert current labels plus highlighted navigation targets.

- [ ] **Step 3: Cover deletion, permissions, and collaboration**

Delete a row and a document block and assert in-place unavailable labels. Open as a viewer and assert navigation without mutation controls. With two editors, insert a reference while the peer types adjacent text; reload and assert the reference remains atomic and both edits persist.

Use keyboard-only insertion/removal once, verify focus returns to the editor after the picker closes, and assert the compact labels expose full tooltip/accessibility text without overflowing their container.

- [ ] **Step 4: Run focused E2E**

```bash
npx playwright test tests/e2e/specs/document-references.spec.ts --workers=1
```

Expected: PASS with no console errors or failed requests.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/specs/document-references.spec.ts tests/e2e/pages/project.page.ts
git commit -m "test: cover document resource references end to end"
```

### Task 10: Final Verification

**Files:**
- No planned file changes; any failure starts a focused debugging cycle before editing.

- [ ] **Step 1: Run document unit tests**

```bash
npm run test:unit -- tests/unit/documents src/lib/documents/sanctionedMdx.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run Agent regressions**

```bash
npm run test:unit -- tests/unit/agent/document-tools.test.ts tests/unit/agent/project-document-chunking.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 3: Run static checks**

```bash
npm run lint
npm run typecheck
npm run typecheck:api
```

Expected: all exit 0.

- [ ] **Step 4: Run the document browser matrix**

```bash
npx playwright test tests/e2e/specs/documents.spec.ts tests/e2e/specs/document-collaboration.spec.ts tests/e2e/specs/document-version-history.spec.ts tests/e2e/specs/document-phase2.spec.ts tests/e2e/specs/document-references.spec.ts --workers=1
```

Expected: PASS.

- [ ] **Step 5: Build production output**

```bash
npm run build
```

Expected: build exits 0.

- [ ] **Step 6: Inspect final scope**

```bash
git diff --check HEAD~9..HEAD
git status --short
git log --oneline -10
```

Expected: no whitespace errors; feature commits contain only planned files; pre-existing user changes remain untouched.
