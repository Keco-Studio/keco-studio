-- Document notes (mirrors library description / Create Table notes field).
alter table public.documents
  add column if not exists description text not null default '';

comment on column public.documents.description is
  'Optional short notes for the document (max 250 chars enforced in app).';
