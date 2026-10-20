-- Agent create requests survive retries, including after their output is removed.
create table public.agent_game_design_system_create_requests (
  actor_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  system_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, idempotency_key)
);

alter table public.agent_game_design_system_create_requests enable row level security;
revoke all on public.agent_game_design_system_create_requests from public, anon, authenticated;

create function public.create_agent_game_design_system(
  p_actor_id uuid,
  p_idempotency_key uuid,
  p_title text,
  p_summary text,
  p_rules jsonb,
  p_document jsonb,
  p_rendered_markdown text,
  p_diff jsonb,
  p_content_hash text
)
returns public.game_design_systems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_request public.agent_game_design_system_create_requests;
  v_system public.game_design_systems;
begin
  if (select auth.role()) <> 'service_role' or p_actor_id is null
    or p_idempotency_key is null or p_title is null or btrim(p_title) = ''
    or p_rules is null then
    raise exception 'Invalid Game Design System create request' using errcode = '22023';
  end if;

  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'title', p_title, 'summary', p_summary, 'rules', p_rules
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_actor_id::text || ':agent_gds_create:' || p_idempotency_key::text, 0));

  select * into v_request
  from public.agent_game_design_system_create_requests
  where actor_id = p_actor_id and idempotency_key = p_idempotency_key;
  if found then
    if v_request.input_hash <> v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    select * into v_system from public.game_design_systems where id = v_request.system_id;
    if not found then
      raise exception 'IDEMPOTENCY_OUTPUT_DELETED' using errcode = 'P0002';
    end if;
    return v_system;
  end if;

  insert into public.game_design_systems (
    owner_id, source, title, summary, genres, philosophies, suitable_for,
    body, provenance, status, generation_job_id
  ) values (
    p_actor_id, 'user', p_title, p_summary, '{}'::text[], '{}'::text[], null,
    '', '{}'::jsonb, 'draft', null
  ) returning * into v_system;

  perform public.create_game_design_system_version(
    v_system.id, null, p_document, null, false, p_rules,
    p_rendered_markdown, '[]'::jsonb, p_diff,
    coalesce(p_diff -> 'conflicts', '[]'::jsonb), p_content_hash,
    p_actor_id, null, null, null
  );

  insert into public.agent_game_design_system_create_requests (
    actor_id, idempotency_key, input_hash, system_id
  ) values (p_actor_id, p_idempotency_key, v_hash, v_system.id);

  select * into v_system from public.game_design_systems where id = v_system.id;
  return v_system;
end;
$$;

revoke all on function public.create_agent_game_design_system(
  uuid, uuid, text, text, jsonb, jsonb, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.create_agent_game_design_system(
  uuid, uuid, text, text, jsonb, jsonb, text, jsonb, text
) to service_role;

-- The original create RPC compares snapshots when replaying p_version_id. This
-- authorized lookup lets a request replay after the document has since changed.
create table public.document_version_create_requests (
  version_id uuid primary key,
  document_id uuid not null,
  name text not null,
  actor_id uuid,
  created_at timestamptz not null default now()
);

insert into public.document_version_create_requests (version_id, document_id, name, actor_id, created_at)
select id, document_id, name, created_by, created_at
from public.document_versions where version_type = 'manual';

alter table public.document_version_create_requests enable row level security;
revoke all on public.document_version_create_requests from public, anon, authenticated;

create function public.record_document_version_create_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.version_type = 'manual' then
    insert into public.document_version_create_requests (
      version_id, document_id, name, actor_id
    ) values (new.id, new.document_id, new.name, new.created_by);
  end if;
  return new;
end;
$$;

create trigger record_document_version_create_request
  after insert on public.document_versions
  for each row execute function public.record_document_version_create_request();

create function public.get_document_version_create_request(
  p_version_id uuid,
  p_document_id uuid,
  p_name text
)
returns table (
  version_id uuid, document_id uuid, project_id uuid, name text,
  version_type text, source_version_id uuid, snapshot_epoch bigint,
  snapshot_revision bigint, created_by uuid, created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_project_id uuid;
  v_version public.document_versions;
  v_request public.document_version_create_requests;
begin
  select d.project_id into v_project_id from public.documents d
  where d.id = p_document_id;
  if not found or v_user_id is null or not (
    public.is_project_owner(v_project_id, v_user_id)
    or public.is_editor_or_admin_collaborator(v_project_id, v_user_id)
  ) then
    raise exception 'Document not found or not writable' using errcode = '42501';
  end if;

  select * into v_request from public.document_version_create_requests r
  where r.version_id = p_version_id;
  if not found then return; end if;
  if v_request.document_id <> p_document_id or v_request.name <> p_name
    or v_request.actor_id is distinct from v_user_id then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
  end if;
  select * into v_version from public.document_versions v where v.id = p_version_id;
  if not found then
    raise exception 'IDEMPOTENCY_OUTPUT_DELETED' using errcode = 'P0002';
  end if;

  return query select v_version.id, v_version.document_id, v_version.project_id,
    v_version.name, v_version.version_type, v_version.source_version_id,
    v_version.snapshot_epoch, v_version.snapshot_revision, v_version.created_by,
    v_version.created_at;
end;
$$;

revoke all on function public.get_document_version_create_request(uuid, uuid, text)
  from public, anon;
grant execute on function public.get_document_version_create_request(uuid, uuid, text)
  to authenticated;

alter table public.folders
  add column agent_create_key uuid,
  add column agent_create_hash text,
  add constraint folders_agent_create_pair_check check (
    (agent_create_key is null and agent_create_hash is null)
    or (agent_create_key is not null and agent_create_hash ~ '^[a-f0-9]{64}$')
  );
alter table public.libraries
  add column agent_create_key uuid,
  add column agent_create_hash text,
  add constraint libraries_agent_create_pair_check check (
    (agent_create_key is null and agent_create_hash is null)
    or (agent_create_key is not null and agent_create_hash ~ '^[a-f0-9]{64}$')
  );

create unique index folders_agent_create_key_idx on public.folders(project_id, agent_create_key)
  where agent_create_key is not null;
create unique index libraries_agent_create_key_idx on public.libraries(project_id, agent_create_key)
  where agent_create_key is not null;

create table public.agent_studio_create_requests (
  actor_id uuid not null,
  project_id uuid not null,
  operation text not null check (operation in ('folder', 'library')),
  idempotency_key uuid not null,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, project_id, operation, idempotency_key)
);
alter table public.agent_studio_create_requests enable row level security;
revoke all on public.agent_studio_create_requests from public, anon, authenticated;

create function public.record_agent_studio_create_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if new.agent_create_key is null then return new; end if;
  if v_actor is null then
    raise exception 'Authenticated actor required for keyed Studio create' using errcode = '42501';
  end if;
  insert into public.agent_studio_create_requests (
    actor_id, project_id, operation, idempotency_key, input_hash, resource_id
  ) values (
    v_actor, new.project_id,
    case when tg_table_name = 'folders' then 'folder' else 'library' end,
    new.agent_create_key, new.agent_create_hash, new.id
  );
  return new;
end;
$$;

create trigger folders_agent_create_request after insert on public.folders
  for each row execute function public.record_agent_studio_create_request();
create trigger libraries_agent_create_request after insert on public.libraries
  for each row execute function public.record_agent_studio_create_request();

create function public.get_agent_studio_create_request(
  p_project_id uuid, p_operation text, p_idempotency_key uuid, p_input_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_request public.agent_studio_create_requests;
begin
  if v_actor is null or not public.is_project_owner_or_admin(p_project_id, v_actor) then
    raise exception 'Only project admins can create Studio resources' using errcode = '42501';
  end if;
  if p_operation not in ('folder', 'library') or p_idempotency_key is null
    or p_input_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid Studio create request' using errcode = '22023';
  end if;
  select * into v_request from public.agent_studio_create_requests
  where actor_id = v_actor and project_id = p_project_id
    and operation = p_operation and idempotency_key = p_idempotency_key;
  if not found then return null; end if;
  if v_request.input_hash <> p_input_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
  end if;
  if p_operation = 'folder' then
    perform 1 from public.folders where id = v_request.resource_id and project_id = p_project_id;
  else
    perform 1 from public.libraries where id = v_request.resource_id and project_id = p_project_id;
  end if;
  if not found then
    raise exception 'IDEMPOTENCY_OUTPUT_DELETED' using errcode = 'P0002';
  end if;
  return v_request.resource_id;
end;
$$;

revoke all on function public.get_agent_studio_create_request(uuid, text, uuid, text)
  from public, anon;
grant execute on function public.get_agent_studio_create_request(uuid, text, uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
