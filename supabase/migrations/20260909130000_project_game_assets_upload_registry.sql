-- Project-scoped registry for manually uploaded game images. Generated map and
-- character records remain in their lifecycle-specific tables and are read
-- into the same UI contract by the application service.
create table if not exists public.project_game_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 255),
  category text not null default 'other' check (category in ('character','animation','map','ui','effect','other')),
  status text not null default 'ready' check (status in ('ready','queued','generating','failed','blocked','planned')),
  mime_type text not null,
  storage_path text not null unique,
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  width integer,
  height integer,
  has_transparency boolean,
  file_size bigint not null check (file_size > 0 and file_size <= 5242880),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_game_assets_project_idx
  on public.project_game_assets(project_id, created_at desc);

alter table public.project_game_assets enable row level security;

drop policy if exists project_game_assets_select on public.project_game_assets;
create policy project_game_assets_select on public.project_game_assets for select using (
  public.is_project_owner(project_id, (select auth.uid()))
  or public.is_accepted_collaborator(project_id, (select auth.uid()))
);

drop policy if exists project_game_assets_insert on public.project_game_assets;
create policy project_game_assets_insert on public.project_game_assets for insert with check (
  created_by = (select auth.uid())
  and (public.is_project_owner(project_id, (select auth.uid()))
    or public.is_accepted_collaborator(project_id, (select auth.uid())))
);

drop policy if exists project_game_assets_update on public.project_game_assets;
create policy project_game_assets_update on public.project_game_assets for update using (
  public.is_project_owner(project_id, (select auth.uid()))
  or public.is_accepted_collaborator(project_id, (select auth.uid()))
);

grant select, insert, update on public.project_game_assets to authenticated;

-- Existing bucket policies already scope writes to the authenticated user's
-- first path segment; the API additionally validates the project segment.
