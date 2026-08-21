-- Add actor-bound idempotency for MCP-created Create Map V3 drafts.

create table public.map_creation_requests (
  actor_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  map_id uuid not null references public.map_projects(id) on delete cascade,
  revision_id uuid not null references public.map_revisions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (actor_id, idempotency_key)
);

alter table public.map_creation_requests enable row level security;
revoke all on table public.map_creation_requests from public, anon, authenticated, service_role;

create function public.create_map_project_v3_idempotent(
  p_project_id uuid,
  p_idempotency_key uuid,
  p_input_hash text,
  p_name text,
  p_source_document_id uuid,
  p_source_document_updated_at timestamptz,
  p_source_epoch bigint,
  p_source_revision bigint,
  p_plan jsonb,
  p_scene jsonb
)
returns table (
  map_id uuid,
  draft_revision_id uuid,
  revision_number bigint,
  save_version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_request public.map_creation_requests%rowtype;
  v_created record;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'input hash must be lowercase SHA-256' using errcode = '22023';
  end if;

  -- Serialize both existing rows and the otherwise-unlocked absent-key case.
  perform pg_advisory_xact_lock(
    hashtextextended(v_actor_id::text || ':' || p_idempotency_key::text, 0)
  );
  select *
  into v_request
  from public.map_creation_requests
  where actor_id = v_actor_id
    and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_request.input_hash <> p_input_hash then
      raise exception 'IDEMPOTENCY_CONFLICT'
        using errcode = 'KM409';
    end if;
    return query select
      v_request.map_id,
      v_request.revision_id,
      1::bigint,
      0::bigint;
    return;
  end if;

  select *
  into strict v_created
  from public.create_map_project_v3(
    p_project_id,
    p_name,
    p_source_document_id,
    p_source_document_updated_at,
    p_source_epoch,
    p_source_revision,
    p_plan,
    p_scene
  );

  insert into public.map_creation_requests (
    actor_id,
    idempotency_key,
    input_hash,
    map_id,
    revision_id
  ) values (
    v_actor_id,
    p_idempotency_key,
    p_input_hash,
    v_created.map_id,
    v_created.draft_revision_id
  );

  return query select
    v_created.map_id::uuid,
    v_created.draft_revision_id::uuid,
    v_created.revision_number::bigint,
    v_created.save_version::bigint;
end;
$$;

revoke all on function public.create_map_project_v3_idempotent(
  uuid, uuid, text, text, uuid, timestamptz, bigint, bigint, jsonb, jsonb
) from public, anon, service_role;
grant execute on function public.create_map_project_v3_idempotent(
  uuid, uuid, text, text, uuid, timestamptz, bigint, bigint, jsonb, jsonb
) to authenticated;

notify pgrst, 'reload schema';
