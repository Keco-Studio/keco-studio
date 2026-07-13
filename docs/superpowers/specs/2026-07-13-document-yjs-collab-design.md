# Document Yjs Collaboration Design

**Date:** 2026-07-13  
**Scope:** Phase 2 subtask A — realtime co-editing + presence cursors for in-app documents  
**Status:** Approved for implementation

## Goal

Make document editing product-default multiplayer: two editors see each other's keystrokes and cursors without refresh. Replace Phase 1 debounced Markdown LWW with **Yjs sync + Postgres persistence**.

## Decisions

| Decision | Choice |
|----------|--------|
| Product posture | Default on for all document pages (not a spike flag) |
| Network provider | Supabase Realtime broadcast as Yjs transport (in-house thin provider) |
| Not chosen | Dedicated `y-websocket` server; community `y-supabase` as a runtime dependency |
| Contrast with #214 | Table providerless Yjs is being removed; documents use Yjs **with** a real provider or not at all |
| Presence cursors | Yjs awareness on the same provider (not library Supabase Presence) |

## Architecture

```
DocumentEditor
  ├── DocumentYjsProvider (Supabase channel doc-collab:{documentId})
  │     ├── broadcast yjs-update
  │     └── broadcast yjs-awareness
  └── MdxDocumentEditor
        └── realm collaboration plugin
              └── @lexical/yjs binding + cursor sync on rootEditor$
```

Persistence (debounced, not the conflict authority):

- `documents.yjs_state` — base64 of `Y.encodeStateAsUpdate` (authoritative)
- `documents.content` — Markdown snapshot for export/sidebar/agent
- `updated_at` — last persist time only (no LWW)

## Permissions

| Role | Sync | Edit | Persist |
|------|------|------|---------|
| owner / admin / editor | yes | yes | yes |
| viewer | yes | readOnly | no |

## Out of scope

Offline/IndexedDB, version history, comments, full MDX/JSX, y-websocket service, changing library Yjs (#214), sharded large-doc persistence.

## Acceptance

1. Two editors co-edit the same doc live  
2. Remote cursors with name + color  
3. Reload restores from `yjs_state`; `content` stays fresh  
4. Viewer syncs read-only  
5. No Phase 1 stale-banner as the normal collab path  
