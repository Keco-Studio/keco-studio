# Script Dialogue UX And Studio Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add plot-node branch navigation and width-fitted flow charts to Script while making Studio hide, reject, and redirect script-derived libraries.

**Architecture:** Reuse the existing script-player option model and visual-novel styles, with a callback from the dialogue view into `ScriptSplitView` for cross-plot navigation. Keep the custom SVG graph and add a measured transform viewport around its canvas. Treat Studio isolation as a presentation boundary: filter Studio-facing library collections, guard the Studio library route, remove its generation entry, and freeze the Agent workspace surface into conversation scope so server-side tools can reject Studio script generation.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS modules, TanStack Query, Jest

---

### Task 1: Dialogue presentation and plot-node choices

**Files:**
- Modify: `src/components/libraries/components/visualNovelPresentation.ts`
- Modify: `src/components/libraries/components/visualNovelPresentation.test.ts`
- Modify: `src/components/libraries/components/scriptPlayer.ts`
- Modify: `src/components/libraries/components/scriptPlayer.test.ts`
- Modify: `src/components/libraries/components/VisualNovelScriptView.tsx`
- Modify: `src/components/libraries/components/VisualNovelScriptView.module.css`
- Modify: `src/components/script-system/ScriptSplitView.tsx`
- Modify: `src/components/script-system/ScriptSplitView.test.tsx`

- [ ] **Step 1: Write failing tests for centered Type 4 presentation and public option extraction**

```ts
expect(resolveVisualNovelPresentation('4', 'Speaker')).toEqual({
  kind: 'plain', color: null, alignment: 'center',
});
expect(readScriptOptions(choiceRow, columns)).toEqual([
  { index: 0, text: 'Take the road', targetLabel: 'Road', commands: '' },
]);
```

- [ ] **Step 2: Run the focused tests and verify they fail for left alignment and the missing option API**

Run: `npm run test:unit -- --runInBand src/components/libraries/components/visualNovelPresentation.test.ts src/components/libraries/components/scriptPlayer.test.ts`

Expected: FAIL because Type 4 is left aligned and `readScriptOptions` is not exported.

- [ ] **Step 3: Implement centered plain presentation and expose the existing option reader**

```ts
case '4':
  return { kind: 'plain', color: null, alignment: 'center' };

export function readScriptOptions(
  row: AssetRow,
  columns: ScriptPlayerColumns
): ScriptPlayerOption[] {
  // Existing option-column parsing body.
}
```

Update `.plainTextRow` to center its contents and `.plainText` to use a bounded readable width with centered text.

- [ ] **Step 4: Write a failing plot-node wiring test**

Add a pure `findPlotNodeIdForLabel` assertion showing that a target Label row resolves to the graph node whose `rowIndexes` contain it, and assert plot-node markup contains choice buttons but no Restart toolbar.

- [ ] **Step 5: Run the Script split test and verify the new behavior fails**

Run: `npm run test:unit -- --runInBand src/components/script-system/ScriptSplitView.test.tsx`

Expected: FAIL because plot-node mode does not render options and has no cross-node callback.

- [ ] **Step 6: Implement plot-node option rendering and callback navigation**

```ts
type VisualNovelScriptViewProps = {
  // existing props
  onChoosePlotOption?: (targetLabel: string) => void;
};
```

Collect filled options across selected rows using `readScriptOptions`, render the existing `choicePanel`/`choiceButton`, and call the callback only when the selected option has a target Label. In `ScriptSplitView`, resolve the target Label against all rows and select its owning graph node.

- [ ] **Step 7: Run dialogue and Script split tests**

Run: `npm run test:unit -- --runInBand src/components/libraries/components/visualNovelPresentation.test.ts src/components/libraries/components/scriptPlayer.test.ts src/components/script-system/ScriptSplitView.test.tsx`

Expected: PASS.

### Task 2: Flow chart fit width and manual zoom

**Files:**
- Modify: `src/components/script-system/FlowChartPanel.tsx`
- Modify: `src/components/script-system/FlowChartPanel.test.tsx`
- Modify: `src/components/script-system/ScriptSplitView.module.css`

- [ ] **Step 1: Write failing tests for fit scale and zoom clamping**

```ts
expect(calculateFitScale(500, 1000)).toBe(0.5);
expect(calculateFitScale(1200, 600)).toBe(2);
expect(clampFlowScale(0.05)).toBe(MIN_FLOW_SCALE);
expect(clampFlowScale(5)).toBe(MAX_FLOW_SCALE);
```

Also assert server markup has a scale viewport instead of `data-flow-centered="true"`.

- [ ] **Step 2: Run the flow chart test and verify missing helpers/markup fail**

Run: `npm run test:unit -- --runInBand src/components/script-system/FlowChartPanel.test.tsx`

Expected: FAIL because the fit/zoom APIs and viewport do not exist.

- [ ] **Step 3: Implement measured fit scale, reset, and Ctrl/Command wheel zoom**

Use `ResizeObserver` on `.flowBody`, compute `clampFlowScale(availableWidth / layout.width)` (narrow trees enlarge up to `MAX_FLOW_SCALE`; wide trees shrink), reset to fit when the graph/layout identity changes, and adjust the current scale in bounded increments for modifier-wheel events. Give an outer viewport the scaled width/height and apply `transform: scale(...)` with `transform-origin: top left` to the existing canvas.

- [ ] **Step 4: Restrict scrolling to the vertical axis**

Set `.flowBody` to `overflow-x: hidden; overflow-y: auto;` and remove scroll-centering behavior.

- [ ] **Step 5: Run flow chart tests**

Run: `npm run test:unit -- --runInBand src/components/script-system/FlowChartPanel.test.tsx`

Expected: PASS, including unchanged preview markers.

### Task 3: Studio UI isolation and route redirect

**Files:**
- Modify: `src/components/layout/ContextMenu.tsx`
- Modify: `src/components/layout/hooks/useSidebarContextMenuActions.ts`
- Modify: `src/components/layout/hooks/useSidebarFoldersLibraries.ts`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/app/(dashboard)/[projectId]/[libraryId]/page.tsx`
- Modify: `tests/unit/documents/document-derived-sidebar.test.tsx`
- Create: `tests/unit/layout/studio-library-isolation.test.ts`

- [ ] **Step 1: Write failing tests for menu removal and Studio collection filtering**

```ts
expect(documentMenuMarkup).toContain('Generate table');
expect(documentMenuMarkup).not.toContain('Generate conversation');
expect(filterStudioLibraries(libraries).map((library) => library.id)).toEqual([
  'regular', 'table-derived',
]);
```

- [ ] **Step 2: Run the isolation tests and verify they fail**

Run: `npm run test:unit -- --runInBand tests/unit/documents/document-derived-sidebar.test.tsx tests/unit/layout/studio-library-isolation.test.ts`

Expected: FAIL because the menu still exposes conversation generation and Studio collections are unfiltered.

- [ ] **Step 3: Remove Studio generation action and filter Studio consumers**

Remove `generate-conversation` from `ContextMenuAction`, the document menu, and `useSidebarContextMenuActions`. Add a reusable `filterStudioLibraries` helper. Let `useSidebarFoldersLibraries` return both raw and optionally filtered libraries; Studio Sidebar uses filtered data for tree/count/drag UI while destructive document operations retain raw data. TopBar Studio search uses filtered data; Script consumers keep script libraries.

- [ ] **Step 4: Add the Studio route redirect**

After `getLibrary` resolves, call:

```ts
router.replace(`/script-system/${projectId}/script/${libraryId}`);
```

when `document_export_type === 'script'`, and render only the loading state while the redirect is pending.

- [ ] **Step 5: Run Studio isolation tests**

Run: `npm run test:unit -- --runInBand tests/unit/documents/document-derived-sidebar.test.tsx tests/unit/layout/studio-library-isolation.test.ts`

Expected: PASS.

### Task 4: Agent workspace boundary

**Files:**
- Modify: `src/components/agent/types.ts`
- Modify: `src/components/agent/ChatPanel.tsx`
- Modify: `src/components/agent/useAgentChat.ts`
- Modify: `src/lib/agent/types.ts`
- Modify: `src/lib/agent/scope.ts`
- Modify: `src/app/api/agent-chat/route.ts`
- Modify: `src/app/api/agent-chat/confirm/route.ts`
- Modify: `src/lib/agent/tools/generate-from-document.ts`
- Modify: `tests/unit/agent/scope.test.ts`
- Modify: `tests/unit/agent/generate-from-document.test.ts`

- [ ] **Step 1: Write failing scope and tool-guard tests**

```ts
expect(resolveScopeFromNavigation({ projectId, workspace: 'script' }).workspace)
  .toBe('script');
expect(studioScriptPreparation).toEqual({
  success: false,
  error: 'Generate conversation is available only in Script. Open Script and try again.',
});
```

Verify Script workspace preparation still succeeds.

- [ ] **Step 2: Run Agent tests and verify missing workspace behavior fails**

Run: `npm run test:unit -- --runInBand tests/unit/agent/scope.test.ts tests/unit/agent/generate-from-document.test.ts`

Expected: FAIL because workspace is not captured and Studio script export is accepted.

- [ ] **Step 3: Freeze workspace in conversation scope and reject at preparation**

Add `workspace: 'studio' | 'script'` to live send context, `ConversationScope`, and `ToolContext`. Derive it from `isScriptSystemPath(pathname)` in `ChatPanel`, include it only when creating a conversation, restore it from the bound scope on normal and confirmation routes, and reject `exportType: 'script'` before document resolution when workspace is not Script.

- [ ] **Step 4: Run Agent tests**

Run: `npm run test:unit -- --runInBand tests/unit/agent/scope.test.ts tests/unit/agent/generate-from-document.test.ts`

Expected: PASS; table generation remains accepted in Studio and script generation remains accepted in Script.

### Task 5: Integrated verification

**Files:**
- Review all modified files

- [ ] **Step 1: Run all focused tests**

Run: `npm run test:unit -- --runInBand src/components/libraries/components/visualNovelPresentation.test.ts src/components/libraries/components/scriptPlayer.test.ts src/components/script-system/FlowChartPanel.test.tsx src/components/script-system/ScriptSplitView.test.tsx tests/unit/documents/document-derived-sidebar.test.tsx tests/unit/layout/studio-library-isolation.test.ts tests/unit/agent/generate-from-document.test.ts tests/unit/agent/scope.test.ts`

Expected: PASS.

- [ ] **Step 2: Run static verification**

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run lint`

Expected: PASS with no new warnings.

- [ ] **Step 3: Review the final diff against every acceptance criterion**

Confirm no player Restart toolbar appears in plot-node mode, preview highlighting attributes remain, Studio retains Generate table, Script generation paths remain, and no database schema or Story graph reader behavior changed.
