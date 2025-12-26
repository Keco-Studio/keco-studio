-- Ensure library_field_definitions exists before assets/values migrations run
create table if not exists public.library_field_definitions (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries(id) on delete cascade,
  section text not null,
  label text not null,
  data_type text not null check (data_type in ('string','int','float','boolean','enum','date')),
  enum_options text[] default null,
  required boolean default false,
  order_index int not null default 0,
  created_at timestamptz default now(),
  unique(library_id, section, label)
);

create index if not exists idx_library_field_definitions_library_id
  on public.library_field_definitions(library_id);

create index if not exists idx_library_field_definitions_order
  on public.library_field_definitions(library_id, section, order_index);

alter table public.library_field_definitions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'lfd_select_auth' and tablename = 'library_field_definitions'
  ) then
    create policy lfd_select_auth on public.library_field_definitions
      for select to authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where policyname = 'lfd_insert_auth' and tablename = 'library_field_definitions'
  ) then
    create policy lfd_insert_auth on public.library_field_definitions
      for insert to authenticated with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where policyname = 'lfd_update_auth' and tablename = 'library_field_definitions'
  ) then
    create policy lfd_update_auth on public.library_field_definitions
      for update to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where policyname = 'lfd_delete_auth' and tablename = 'library_field_definitions'
  ) then
    create policy lfd_delete_auth on public.library_field_definitions
      for delete to authenticated using (true);
  end if;
end$$;


