-- Durable, private idempotency state for synchronous project-template creation.

create table public.project_template_instantiations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  template_key text not null check (length(trim(template_key)) > 0),
  template_version integer not null check (template_version > 0),
  status text not null check (status in ('running', 'completed', 'failed')),
  project_id uuid references public.projects(id) on delete set null,
  default_folder_id uuid references public.folders(id) on delete set null,
  design_system_id uuid references public.game_design_systems(id) on delete set null,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, request_id)
);

create index project_template_instantiations_project_idx
  on public.project_template_instantiations(project_id)
  where project_id is not null;

alter table public.project_template_instantiations enable row level security;
revoke all on table public.project_template_instantiations from public, anon, authenticated;
grant select, insert, update, delete on table public.project_template_instantiations to service_role;

create function public.claim_project_template_instantiation(
  p_owner_id uuid,
  p_request_id uuid,
  p_template_key text,
  p_template_version integer
)
returns table (
  id uuid,
  claimed boolean,
  status text,
  project_id uuid,
  default_folder_id uuid,
  design_system_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_row public.project_template_instantiations%rowtype;
begin
  if p_owner_id is null or p_request_id is null
    or length(trim(coalesce(p_template_key, ''))) = 0
    or p_template_version <= 0 then
    raise exception 'invalid project template request' using errcode = '22023';
  end if;

  insert into public.project_template_instantiations (
    owner_id, request_id, template_key, template_version, status
  ) values (
    p_owner_id, p_request_id, trim(p_template_key), p_template_version, 'running'
  )
  on conflict (owner_id, request_id) do nothing
  returning project_template_instantiations.id into v_id;

  select instantiation.* into v_row
  from public.project_template_instantiations instantiation
  where instantiation.owner_id = p_owner_id
    and instantiation.request_id = p_request_id
  for update;

  if v_row.template_key <> trim(p_template_key)
    or v_row.template_version <> p_template_version then
    raise exception 'template request conflicts with its original template'
      using errcode = 'PT409';
  end if;

  if v_id is not null then
    return query select v_row.id, true, v_row.status, v_row.project_id,
      v_row.default_folder_id, v_row.design_system_id;
    return;
  end if;

  if v_row.status = 'failed' then
    if v_row.project_id is not null or v_row.default_folder_id is not null
      or v_row.design_system_id is not null then
      raise exception 'failed template request still owns resources'
        using errcode = 'PT409';
    end if;
    update public.project_template_instantiations instantiation
    set status = 'running', error_code = null, updated_at = clock_timestamp()
    where instantiation.id = v_row.id
    returning instantiation.* into v_row;
    return query select v_row.id, true, v_row.status, v_row.project_id,
      v_row.default_folder_id, v_row.design_system_id;
    return;
  end if;

  return query select v_row.id, false, v_row.status, v_row.project_id,
    v_row.default_folder_id, v_row.design_system_id;
end;
$$;

create function public.checkpoint_project_template_instantiation(
  p_instantiation_id uuid,
  p_owner_id uuid,
  p_project_id uuid default null,
  p_default_folder_id uuid default null,
  p_design_system_id uuid default null
)
returns table (
  id uuid,
  claimed boolean,
  status text,
  project_id uuid,
  default_folder_id uuid,
  design_system_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.project_template_instantiations%rowtype;
begin
  select instantiation.* into v_row
  from public.project_template_instantiations instantiation
  where instantiation.id = p_instantiation_id
    and instantiation.owner_id = p_owner_id
  for update;
  if not found then raise exception 'template instantiation not found' using errcode = 'P0002'; end if;
  if v_row.status <> 'running' then raise exception 'template instantiation is not running' using errcode = 'PT409'; end if;

  if (v_row.project_id is not null and p_project_id is not null and v_row.project_id <> p_project_id)
    or (v_row.default_folder_id is not null and p_default_folder_id is not null and v_row.default_folder_id <> p_default_folder_id)
    or (v_row.design_system_id is not null and p_design_system_id is not null and v_row.design_system_id <> p_design_system_id) then
    raise exception 'template instantiation checkpoint conflicts with stored resources' using errcode = 'PT409';
  end if;

  update public.project_template_instantiations instantiation
  set project_id = coalesce(instantiation.project_id, p_project_id),
      default_folder_id = coalesce(instantiation.default_folder_id, p_default_folder_id),
      design_system_id = coalesce(instantiation.design_system_id, p_design_system_id),
      updated_at = clock_timestamp()
  where instantiation.id = v_row.id
  returning instantiation.* into v_row;

  return query select v_row.id, true, v_row.status, v_row.project_id,
    v_row.default_folder_id, v_row.design_system_id;
end;
$$;

create function public.complete_project_template_instantiation(
  p_instantiation_id uuid,
  p_owner_id uuid,
  p_project_id uuid,
  p_default_folder_id uuid,
  p_design_system_id uuid
)
returns table (
  id uuid,
  claimed boolean,
  status text,
  project_id uuid,
  default_folder_id uuid,
  design_system_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.project_template_instantiations%rowtype;
begin
  update public.project_template_instantiations instantiation
  set status = 'completed', error_code = null, updated_at = clock_timestamp()
  where instantiation.id = p_instantiation_id
    and instantiation.owner_id = p_owner_id
    and instantiation.status = 'running'
    and instantiation.project_id = p_project_id
    and instantiation.default_folder_id = p_default_folder_id
    and instantiation.design_system_id = p_design_system_id
  returning instantiation.* into v_row;
  if not found then raise exception 'template instantiation completion conflicts with stored resources' using errcode = 'PT409'; end if;

  return query select v_row.id, false, v_row.status, v_row.project_id,
    v_row.default_folder_id, v_row.design_system_id;
end;
$$;

create function public.fail_project_template_instantiation(
  p_instantiation_id uuid,
  p_owner_id uuid,
  p_error_code text
)
returns table (
  id uuid,
  claimed boolean,
  status text,
  project_id uuid,
  default_folder_id uuid,
  design_system_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.project_template_instantiations%rowtype;
begin
  update public.project_template_instantiations instantiation
  set status = 'failed', error_code = left(coalesce(nullif(trim(p_error_code), ''), 'UNKNOWN'), 120),
      updated_at = clock_timestamp()
  where instantiation.id = p_instantiation_id
    and instantiation.owner_id = p_owner_id
    and instantiation.status = 'running'
  returning instantiation.* into v_row;
  if not found then raise exception 'template instantiation failure transition rejected' using errcode = 'PT409'; end if;

  return query select v_row.id, false, v_row.status, v_row.project_id,
    v_row.default_folder_id, v_row.design_system_id;
end;
$$;

create function public.cleanup_project_template_instantiation(
  p_instantiation_id uuid,
  p_owner_id uuid,
  p_error_code text
)
returns table (cleanup_job_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.project_template_instantiations%rowtype;
  v_cleanup record;
begin
  select instantiation.* into v_row
  from public.project_template_instantiations instantiation
  where instantiation.id = p_instantiation_id
    and instantiation.owner_id = p_owner_id
  for update;
  if not found then raise exception 'template instantiation not found' using errcode = 'P0002'; end if;
  if v_row.status = 'completed' then raise exception 'completed template instantiation cannot be cleaned' using errcode = 'PT409'; end if;

  if v_row.project_id is not null then
    for v_cleanup in
      select cleanup.cleanup_job_id
      from public.delete_project_and_enqueue_storage_cleanup(v_row.project_id) cleanup
    loop
      cleanup_job_id := v_cleanup.cleanup_job_id;
      return next;
    end loop;
  end if;

  if v_row.design_system_id is not null then
    delete from public.game_design_systems design_system
    where design_system.id = v_row.design_system_id
      and design_system.owner_id = p_owner_id
      and not exists (
        select 1 from public.project_game_design_systems binding
        where binding.design_system_id = design_system.id
      );
  end if;

  update public.project_template_instantiations instantiation
  set status = 'failed', project_id = null, default_folder_id = null,
      design_system_id = null,
      error_code = left(coalesce(nullif(trim(p_error_code), ''), 'UNKNOWN'), 120),
      updated_at = clock_timestamp()
  where instantiation.id = v_row.id;
end;
$$;

revoke all on function public.claim_project_template_instantiation(uuid, uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.checkpoint_project_template_instantiation(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.complete_project_template_instantiation(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.fail_project_template_instantiation(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.cleanup_project_template_instantiation(uuid, uuid, text) from public, anon, authenticated, service_role;

grant execute on function public.claim_project_template_instantiation(uuid, uuid, text, integer) to service_role;
grant execute on function public.checkpoint_project_template_instantiation(uuid, uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.complete_project_template_instantiation(uuid, uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.fail_project_template_instantiation(uuid, uuid, text) to service_role;
grant execute on function public.cleanup_project_template_instantiation(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
