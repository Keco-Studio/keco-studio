-- Create shared_documents table for collaborative editing
create extension if not exists "pgcrypto";

create table if not exists public.shared_documents (
  id uuid primary key default gen_random_uuid(),
  doc_id text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Updated_at trigger
create or replace function public.update_shared_documents_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_shared_documents_updated_at on public.shared_documents;
create trigger trg_shared_documents_updated_at
before update on public.shared_documents
for each row
execute procedure public.update_shared_documents_updated_at();

-- Enable RLS
alter table public.shared_documents enable row level security;

-- Policies: All authenticated users can read/update documents
create policy shared_documents_select_all on public.shared_documents
  for select using (auth.role() = 'authenticated');

create policy shared_documents_insert_all on public.shared_documents
  for insert with check (auth.role() = 'authenticated');

create policy shared_documents_update_all on public.shared_documents
  for update using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Indexes
create index if not exists idx_shared_documents_doc_id on public.shared_documents(doc_id);
create index if not exists idx_shared_documents_owner_id on public.shared_documents(owner_id);

/*
  Enable Realtime: add this table to the Supabase Realtime publication to turn on live data sync.
  This allows clients to subscribe to and receive real-time updates from the table.
  After adding the shared_documents table to the publication, INSERT/UPDATE/DELETE operations
  on this table will be captured by Supabase Realtime, and the frontend can listen to changes
  over WebSocket (for example via postgres_changes events).
*/
alter publication supabase_realtime add table public.shared_documents;

