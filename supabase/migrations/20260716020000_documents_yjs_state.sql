-- Phase 2A: Yjs collaborative editing for documents.
--
-- Persist the authoritative Yjs document state alongside the Markdown snapshot
-- in `content`. Conflict resolution for concurrent edits is CRDT (Yjs), not
-- updated_at LWW. yjs_state is stored as base64 text so PostgREST/supabase-js
-- round-trips cleanly without bytea encoding edge cases.

alter table public.documents
  add column if not exists yjs_state text;

comment on column public.documents.yjs_state is
  'Base64-encoded Y.encodeStateAsUpdate snapshot. Authoritative collab state; content is a Markdown derivative.';
