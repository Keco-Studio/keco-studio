-- Table: library_assets (basic asset rows)
create table if not exists public.library_assets (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

create index if not exists idx_library_assets_library_id on public.library_assets(library_id);

-- Table: library_asset_values (asset field values)
create table if not exists public.library_asset_values (
  asset_id uuid not null references public.library_assets(id) on delete cascade,
  field_id uuid not null references public.library_field_definitions(id) on delete cascade,
  value_json jsonb,
  primary key (asset_id, field_id)
);

create index if not exists idx_library_asset_values_asset_id on public.library_asset_values(asset_id);
create index if not exists idx_library_asset_values_field_id on public.library_asset_values(field_id);

-- Enable RLS
alter table public.library_assets enable row level security;
alter table public.library_asset_values enable row level security;

do $$
begin
  -- assets policies
  if not exists (select 1 from pg_policies where policyname='la_select_auth' and tablename='library_assets') then
    create policy la_select_auth on public.library_assets for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname='la_insert_auth' and tablename='library_assets') then
    create policy la_insert_auth on public.library_assets for insert to authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname='la_update_auth' and tablename='library_assets') then
    create policy la_update_auth on public.library_assets for update to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname='la_delete_auth' and tablename='library_assets') then
    create policy la_delete_auth on public.library_assets for delete to authenticated using (true);
  end if;

  -- asset values policies
  if not exists (select 1 from pg_policies where policyname='lav_select_auth' and tablename='library_asset_values') then
    create policy lav_select_auth on public.library_asset_values for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname='lav_insert_auth' and tablename='library_asset_values') then
    create policy lav_insert_auth on public.library_asset_values for insert to authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname='lav_update_auth' and tablename='library_asset_values') then
    create policy lav_update_auth on public.library_asset_values for update to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname='lav_delete_auth' and tablename='library_asset_values') then
    create policy lav_delete_auth on public.library_asset_values for delete to authenticated using (true);
  end if;
end$$;


