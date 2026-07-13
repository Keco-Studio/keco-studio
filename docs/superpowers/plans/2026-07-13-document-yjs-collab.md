# Document Yjs Collaboration Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Product-default Yjs co-editing + awareness cursors for documents over Supabase Realtime.

**Architecture:** In-house `DocumentYjsProvider` + MDXEditor realm plugin using `@lexical/yjs`; persist `yjs_state` + Markdown snapshot; remove LWW autosave path.

**Tech Stack:** Yjs, y-protocols, @lexical/yjs 0.35.0, Supabase Realtime broadcast, MDXEditor realmPlugin

## Global Constraints

- English comments only
- No new y-websocket process
- Documents channel: `doc-collab:{documentId}` (not sidebar folders topic)
- Viewer read-only; editors persist

---

### Task 1: Schema + service

- [ ] Migration add `documents.yjs_state text`
- [ ] Extend `DocumentRecord`; add `persistDocumentCollabState`; remove LWW from content updates (keep rename/move/delete)

### Task 2: Provider

- [ ] `src/lib/documents/documentYjsProvider.ts` implementing `@lexical/yjs` `Provider`
- [ ] Unit test: two docs merge via shared apply helper / mock broadcast

### Task 3: Editor wiring

- [ ] `collaborationPlugin.ts` + update `MdxDocumentEditor` / `DocumentEditor`
- [ ] Status UI: connecting / connected / saving / reconnecting
- [ ] Install `y-protocols`, pin `@lexical/yjs`

### Task 4: Tests + validate

- [ ] Update static RLS/migration assertions for `yjs_state`
- [ ] Adjust documents e2e smoke for save indicator
- [ ] `npm run typecheck` + targeted unit tests
