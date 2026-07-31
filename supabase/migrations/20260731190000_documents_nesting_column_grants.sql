-- Extend documents column grants for nesting + notes.
-- Collab migration 20260716030000 limited authenticated UPDATE to (name, folder_id)
-- and INSERT to (project_id, folder_id, name, content, created_by). Moving or nesting
-- documents now also writes parent_document_id; notes use description.

grant insert (project_id, folder_id, name, content, created_by, description)
  on table public.documents to authenticated;

grant update (name, folder_id, parent_document_id, description)
  on table public.documents to authenticated;
