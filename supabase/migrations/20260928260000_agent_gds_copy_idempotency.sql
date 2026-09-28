-- A keyed agent copy creates the system and its first version in one transaction.
create table public.agent_game_design_system_copy_requests (
  actor_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  source_system_id uuid not null,
  copied_system_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, idempotency_key)
);

alter table public.agent_game_design_system_copy_requests enable row level security;
revoke all on public.agent_game_design_system_copy_requests from public, anon, authenticated;

create function public.copy_agent_game_design_system(
  p_actor_id uuid,
  p_idempotency_key uuid,
  p_source_system_id uuid,
  p_expected_version_id uuid,
  p_expected_updated_at timestamptz,
  p_document jsonb,
  p_rendered_markdown text,
  p_diff jsonb
)
returns public.game_design_systems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.game_design_systems;
  v_source_version public.game_design_system_versions;
  v_request public.agent_game_design_system_copy_requests;
  v_copy public.game_design_systems;
begin
  if (select auth.role()) <> 'service_role' or p_actor_id is null
    or p_idempotency_key is null or p_source_system_id is null then
    raise exception 'Invalid Game Design System copy request' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_actor_id::text || ':agent_gds_copy:' || p_idempotency_key::text, 0));

  select * into v_source from public.game_design_systems
  where id = p_source_system_id for share;
  if not found or (v_source.source <> 'official' and v_source.owner_id <> p_actor_id) then
    raise exception 'Source Game Design System is not copyable' using errcode = '42501';
  end if;

  select * into v_request from public.agent_game_design_system_copy_requests
  where actor_id = p_actor_id and idempotency_key = p_idempotency_key;
  if found then
    if v_request.source_system_id <> p_source_system_id then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    select * into v_copy from public.game_design_systems
    where id = v_request.copied_system_id and owner_id = p_actor_id;
    if not found then
      raise exception 'IDEMPOTENCY_OUTPUT_DELETED' using errcode = 'P0002';
    end if;
    return v_copy;
  end if;

  if p_expected_version_id is null or p_expected_updated_at is null
    or p_rendered_markdown is null or p_document is null or p_diff is null
    or v_source.current_version_id is distinct from p_expected_version_id
    or v_source.updated_at is distinct from p_expected_updated_at then
    raise exception 'Source Game Design System changed; retry the copy request' using errcode = 'P0001';
  end if;
  select * into v_source_version from public.game_design_system_versions
  where id = p_expected_version_id and system_id = p_source_system_id for key share;
  if not found then
    raise exception 'Source Game Design System version is not readable' using errcode = 'P0002';
  end if;

  insert into public.game_design_systems (
    owner_id, source, title, summary, genres, philosophies, suitable_for,
    body, provenance, status, generation_job_id
  ) values (
    p_actor_id, 'user', v_source.title || ' (Copy)', v_source.summary,
    '{}'::text[], '{}'::text[], null, '',
    v_source.provenance || jsonb_build_object('baseSystemId', v_source.id),
    'draft', null
  ) returning * into v_copy;

  perform public.create_game_design_system_version(
    v_copy.id, v_source_version.id, coalesce(v_source_version.document, p_document),
    v_source_version.art_style, false, v_source_version.rules,
    p_rendered_markdown, v_source_version.source_snapshots, p_diff,
    coalesce(p_diff -> 'conflicts', '[]'::jsonb),
    v_source_version.content_hash, p_actor_id, null, null, null
  );

  insert into public.agent_game_design_system_copy_requests (
    actor_id, idempotency_key, source_system_id, copied_system_id
  ) values (p_actor_id, p_idempotency_key, p_source_system_id, v_copy.id);

  select * into v_copy from public.game_design_systems where id = v_copy.id;
  return v_copy;
end;
$$;

revoke all on function public.copy_agent_game_design_system(
  uuid, uuid, uuid, uuid, timestamptz, jsonb, text, jsonb
) from public, anon, authenticated;
grant execute on function public.copy_agent_game_design_system(
  uuid, uuid, uuid, uuid, timestamptz, jsonb, text, jsonb
) to service_role;

notify pgrst, 'reload schema';
