-- Ensure library_field_definitions exists before assets/values migrations run
create table if not exists public.library_field_definitions (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries(id) on delete cascade,
  section text not null,
  label text not null,
  data_type text not null check (
    data_type in (
      'string',
      'int',
      'float',
      'boolean',
      'enum',
      'date',
      'int_array',
      'float_array',
      'string_array',
      'multimedia',
      'audio'
    )
  ),
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
    where policyname = 'library_field_definitions_select_policy' and tablename = 'library_field_definitions'
  ) then
    create policy "library_field_definitions_select_policy"
      on public.library_field_definitions for select
      using (
        library_id in (
          select l.id
          from public.libraries l
          join public.projects p on p.id = l.project_id
          where p.owner_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where policyname = 'library_field_definitions_insert_policy' and tablename = 'library_field_definitions'
  ) then
    create policy "library_field_definitions_insert_policy"
      on public.library_field_definitions for insert
      with check (
        library_id in (
          select l.id
          from public.libraries l
          join public.projects p on p.id = l.project_id
          where p.owner_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where policyname = 'library_field_definitions_update_policy' and tablename = 'library_field_definitions'
  ) then
    create policy "library_field_definitions_update_policy"
      on public.library_field_definitions for update
      using (
        library_id in (
          select l.id
          from public.libraries l
          join public.projects p on p.id = l.project_id
          where p.owner_id = auth.uid()
        )
      )
      with check (
        library_id in (
          select l.id
          from public.libraries l
          join public.projects p on p.id = l.project_id
          where p.owner_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where policyname = 'library_field_definitions_delete_policy' and tablename = 'library_field_definitions'
  ) then
    create policy "library_field_definitions_delete_policy"
      on public.library_field_definitions for delete
      using (
        library_id in (
          select l.id
          from public.libraries l
          join public.projects p on p.id = l.project_id
          where p.owner_id = auth.uid()
        )
      );
  end if;
end$$;
