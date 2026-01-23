-- Add updated_at and updated_by columns to library_assets table
alter table public.library_assets 
add column if not exists updated_at timestamptz not null default now(),
add column if not exists updated_by uuid references public.profiles(id) on delete set null;

-- Create index for updated_by lookups
create index if not exists idx_library_assets_updated_by on public.library_assets (updated_by);

-- Create index for finding most recent assets by library
create index if not exists idx_library_assets_library_updated on public.library_assets (library_id, updated_at desc);

-- Update trigger to set updated_by on insert
create or replace function public.set_library_asset_updated_by_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

-- Update trigger to set updated_by on update
create or replace function public.set_library_asset_updated_by_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

-- Create triggers for library_assets table
drop trigger if exists set_library_assets_updated_by_on_insert on public.library_assets;
create trigger set_library_assets_updated_by_on_insert
  before insert on public.library_assets
  for each row
  execute function public.set_library_asset_updated_by_on_insert();

drop trigger if exists set_library_assets_updated_by_on_update on public.library_assets;
create trigger set_library_assets_updated_by_on_update
  before update on public.library_assets
  for each row
  execute function public.set_library_asset_updated_by_on_update();

-- Backfill existing records with library owner as updated_by
update public.library_assets la
set 
  updated_by = p.owner_id,
  updated_at = coalesce(la.created_at, now())
from public.libraries l
join public.projects p on l.project_id = p.id
where la.library_id = l.id and la.updated_by is null;

