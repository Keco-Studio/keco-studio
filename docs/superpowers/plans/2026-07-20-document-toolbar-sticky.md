# Document Toolbar Sticky Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the MDX document formatting toolbar stuck to the top of the dashboard content scroll area while editing.

**Architecture:** Enable MDXEditor’s built-in sticky toolbar by removing the overflow trap on `.editor`, and pass a stable `toolbarClassName` with reinforced sticky styles and opaque background.

**Tech Stack:** CSS Modules, `@mdxeditor/editor` `toolbarPlugin({ toolbarClassName })`, Jest source-wiring tests.

## Global Constraints

- Stick under TopBar via `.content` scrollport (`top: 0`); do not stick document title/status.
- CSS-only; no JS fixed positioning; no toolbar extraction.
- Prefer `toolbarClassName` over brittle hashed class selectors.
- Do not commit unless the user asks.

---

### Task 1: Sticky toolbar CSS + wiring

**Files:**
- Modify: `src/components/documents/MdxDocumentEditor.module.css`
- Modify: `src/components/documents/MdxDocumentEditor.tsx` (`toolbarPlugin` call)
- Test: `tests/unit/documents/document-collaboration-adapter.test.ts` (and/or existing MDX wiring test)

**Interfaces:**
- Consumes: `toolbarPlugin({ toolbarContents, toolbarClassName })`
- Produces: `.stickyToolbar` class applied to MDX toolbar root

- [x] **Step 1: Write failing wiring assertions**

Assert `MdxDocumentEditor.tsx` passes `toolbarClassName: styles.stickyToolbar` (or equivalent) into `toolbarPlugin`, and CSS module defines `.stickyToolbar` with `position: sticky` and `.editor` no longer uses `overflow: hidden`.

- [x] **Step 2: Run test — expect RED**

```bash
npx jest tests/unit/documents/document-collaboration-adapter.test.ts -t 'sticky|toolbar' --no-coverage
```

- [x] **Step 3: Implement CSS + toolbarClassName**

1. `.editor`: `overflow: visible` (was `hidden`).
2. Add `.stickyToolbar` with `position: sticky; top: 0; z-index: 6;` (above collab cursors at 5), solid `background`, matching top `border-radius`, optional bottom border.
3. `toolbarPlugin({ toolbarClassName: styles.stickyToolbar, toolbarContents: ... })`.

- [x] **Step 4: Run tests — expect GREEN**

```bash
npx jest tests/unit/documents/document-collaboration-adapter.test.ts tests/unit/documents/sanctioned-mdx-editor-wiring.test.ts --no-coverage
```

- [ ] **Step 5: Manual check**

Open a long doc, scroll content area: toolbar stays under TopBar; title scrolls away; Insert reference still works.
