-- Phase 1: in-app document authoring.
--
-- Introduce a project-scoped `documents` table that stores rich-text content as
-- Markdown (authored with MDXEditor). project_id is NOT NULL from day one: the
-- old shared_documents table allowed NULL project_id, which left legacy rows
-- inaccessible under RLS (GitHub issue #172). We never repeat that here.
--
-- The dead shared_documents table (jsonb/TipTap era, GitHub #178/#180) is dropped
-- rather than reshaped, and documents are deliberately NOT added to the
-- supabase_realtime publication (GitHub #208): sidebar/live updates ride a
-- broadcast event instead of postgres_changes.

create extension if not exists "pgcrypto";

-- ============================================================================
-- documents table
-- ============================================================================

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete set null,
  name text not null,
  content text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.documents is
  'Project-scoped rich-text documents authored with MDXEditor. content is Markdown.';
comment on column public.documents.project_id is
  'Owning project. NOT NULL from creation so RLS never strands rows (GitHub #172).';

-- List queries filter by project_id / folder_id; index both. content is never
-- filtered on, so it is deliberately left unindexed.
create index if not exists idx_documents_project_id on public.documents(project_id);
create index if not exists idx_documents_folder_id on public.documents(folder_id);

-- Keep updated_at fresh on every UPDATE (last-writer-wins ordering key).
create or replace function public.update_documents_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_documents_updated_at on public.documents;
create trigger trg_documents_updated_at
before update on public.documents
for each row
execute procedure public.update_documents_updated_at();

-- ============================================================================
-- RLS: mirror the project-membership model used across the schema.
--
-- Reads: project owner or ANY accepted collaborator (viewers included).
-- Writes: project owner or accepted admin/editor collaborators only (viewers
-- are read-only). Policies are written in the initPlan-friendly form recommended
-- in GitHub issue #210: auth.uid() wrapped in (select ...) so Postgres evaluates
-- it once per statement, and membership expressed via the SECURITY DEFINER
-- helpers (correlated EXISTS internally) that already prevent RLS recursion.
-- ============================================================================

alter table public.documents enable row level security;

drop policy if exists "documents_select_policy" on public.documents;
drop policy if exists "documents_insert_policy" on public.documents;
drop policy if exists "documents_update_policy" on public.documents;
drop policy if exists "documents_delete_policy" on public.documents;

create policy "documents_select_policy"
  on public.documents for select
  using (
    public.is_project_owner(project_id, (select auth.uid()))
    or public.is_accepted_collaborator(project_id, (select auth.uid()))
  );

create policy "documents_insert_policy"
  on public.documents for insert
  with check (
    public.is_project_owner(project_id, (select auth.uid()))
    or public.is_editor_or_admin_collaborator(project_id, (select auth.uid()))
  );

create policy "documents_update_policy"
  on public.documents for update
  using (
    public.is_project_owner(project_id, (select auth.uid()))
    or public.is_editor_or_admin_collaborator(project_id, (select auth.uid()))
  )
  with check (
    public.is_project_owner(project_id, (select auth.uid()))
    or public.is_editor_or_admin_collaborator(project_id, (select auth.uid()))
  );

create policy "documents_delete_policy"
  on public.documents for delete
  using (
    public.is_project_owner(project_id, (select auth.uid()))
    or public.is_editor_or_admin_collaborator(project_id, (select auth.uid()))
  );

comment on policy "documents_select_policy" on public.documents is
  'Project owners and any accepted collaborator (including viewers) can read documents';
comment on policy "documents_insert_policy" on public.documents is
  'Project owners and accepted admin/editor collaborators can create documents';
comment on policy "documents_update_policy" on public.documents is
  'Project owners and accepted admin/editor collaborators can edit documents';
comment on policy "documents_delete_policy" on public.documents is
  'Project owners and accepted admin/editor collaborators can delete documents';

-- documents is intentionally NOT added to the supabase_realtime publication
-- (GitHub #208). Live sidebar refresh + stale-copy detection use a broadcast
-- event ("document-updated") on an existing project-scoped channel instead.

-- ============================================================================
-- Drop the dead shared_documents table (GitHub #178/#180). It is superseded by
-- documents and is unused by application code. Remove it from the realtime
-- publication first so dropping the table cannot leave a dangling publication
-- entry.
-- ============================================================================

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_documents'
  ) then
    execute 'alter publication supabase_realtime drop table public.shared_documents';
  end if;
end $$;

drop table if exists public.shared_documents cascade;
