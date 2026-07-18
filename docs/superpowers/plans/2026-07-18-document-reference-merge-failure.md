# Document Reference Merge Failure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a type-safe reference insertion flow and make the document-reference smoke test wait for both inserted references to become durable before reloading.

**Architecture:** Keep cursor restoration at the editor boundary by using MDXEditor's callback-capable `focus` method, then invoke the pending insert only after focus is restored. Keep durability verification in Playwright by reading the authoritative document state, which merges the persisted Yjs snapshot and update tail, rather than treating an arbitrary append response as proof that the final edit was saved.

**Tech Stack:** Next.js 16, React 19, TypeScript, MDXEditor/Lexical, Yjs, Supabase, Jest, Playwright.

---

### Task 1: Complete the reference insertion callback contract

**Files:**
- Modify: `src/components/documents/MdxDocumentEditor.tsx`
- Test: `tests/unit/documents/resource-reference-insert-focus.test.ts`
- Test: `tests/unit/documents/sanctioned-mdx-editor-wiring.test.ts`

- [x] **Step 1: Verify the existing regression test fails**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/documents/resource-reference-insert-focus.test.ts
```

Expected: FAIL because `restoreEditorFocus` does not accept or execute the callback.

- [ ] **Step 2: Implement the minimal editor-boundary fix**

Change `restoreEditorFocus` to accept an optional callback, call it through `MDXEditorMethods.focus`, and call it directly only when the editor ref is unavailable. Remove `openReplacement`, `onReplace`, and `initialTarget` wiring because those properties were removed by the current picker/editor refactor.

- [ ] **Step 3: Verify focused tests and type checking**

```bash
npm run test:unit -- --runInBand tests/unit/documents/resource-reference-insert-focus.test.ts tests/unit/documents/resource-reference-picker.test.tsx tests/unit/documents/sanctioned-mdx-editor-wiring.test.ts
npm run typecheck
```

Expected: PASS.

### Task 2: Wait for authoritative reference durability in Playwright

**Files:**
- Modify: `tests/e2e/specs/document-references.spec.ts`

- [ ] **Step 1: Replace append-response timing with an authoritative-state assertion**

Import `readDocumentState` and poll the referencing document Markdown until it contains the table asset ID and source document block ID. Keep the existing post-reload link assertions unchanged.

- [ ] **Step 2: Run focused verification**

```bash
npm run test:unit -- --runInBand tests/unit/documents/resource-reference-insert-focus.test.ts tests/unit/documents/resource-reference-picker.test.tsx tests/unit/documents/sanctioned-mdx-editor-wiring.test.ts tests/unit/documents/resource-reference-service.test.ts
npm run typecheck
npx playwright test tests/e2e/specs/document-references.spec.ts --project=chromium --workers=1
```

Expected: all unit tests and type checking pass; the Playwright smoke test passes when local Supabase is available.
