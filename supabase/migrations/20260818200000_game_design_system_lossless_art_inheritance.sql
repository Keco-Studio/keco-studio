-- Keep omitted Art Style values inside PostgreSQL so unsupported JSONB is never
-- serialized through the public write service.

revoke all on function public.create_game_design_system_version(
  uuid, uuid, jsonb, jsonb, jsonb, text, jsonb, jsonb, jsonb, text, uuid, uuid, uuid, uuid
) from public, anon, authenticated;

drop function if exists public.create_game_design_system_version(
  uuid, uuid, jsonb, jsonb, jsonb, text, jsonb, jsonb, jsonb, text, uuid, uuid, uuid, uuid
);

create function public.create_game_design_system_version(
  p_system_id uuid,
  p_parent_version_id uuid,
  p_document jsonb,
  p_art_style jsonb,
  p_inherit_art_style boolean,
  p_rules jsonb,
  p_rendered_markdown text,
  p_source_snapshots jsonb,
  p_diff jsonb,
  p_conflicts jsonb,
  p_content_hash text, -- deprecated: accepted for compatibility and ignored
  p_created_by uuid,
  p_generation_job_id uuid,
  p_expected_current_version_id uuid,
  p_idempotency_key uuid
)
returns public.game_design_system_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_system public.game_design_systems;
  v_parent_system_id uuid;
  v_parent_system_source text;
  v_parent_system_owner_id uuid;
  v_parent_version public.game_design_system_versions;
  v_effective_art_style jsonb;
  v_effective_content_hash text;
  v_version public.game_design_system_versions;
  v_version_number integer;
  v_actor uuid;
  v_rendered_markdown text;
begin
  select * into v_system
  from public.game_design_systems
  where id = p_system_id
  for update;
  if not found then raise exception 'Game Design System not found' using errcode = 'P0002'; end if;
  if v_system.source <> 'user' then raise exception 'Official systems are immutable' using errcode = '42501'; end if;

  v_actor := (select auth.uid());
  if (select auth.role()) <> 'service_role' then
    if v_actor is null or v_actor <> v_system.owner_id then
      raise exception 'Only the owner can create a version' using errcode = '42501';
    end if;
  else
    v_actor := p_created_by;
  end if;
  if v_actor is null or v_actor <> v_system.owner_id then
    raise exception 'Version actor must own the system' using errcode = '42501';
  end if;

  if p_inherit_art_style is null then
    raise exception 'p_inherit_art_style is required' using errcode = '22004';
  end if;
  if p_inherit_art_style and p_parent_version_id is null then
    raise exception 'Art Style inheritance requires a parent version' using errcode = '23514';
  end if;

  if p_parent_version_id is not null then
    select parent_version.* into v_parent_version
    from public.game_design_system_versions parent_version
    where parent_version.id = p_parent_version_id
    for key share;
    if not found then raise exception 'Parent version not found' using errcode = '23514'; end if;

    select id, source, owner_id
    into v_parent_system_id, v_parent_system_source, v_parent_system_owner_id
    from public.game_design_systems
    where id = v_parent_version.system_id;
    if not found then raise exception 'Parent system not found' using errcode = '23514'; end if;
    if v_parent_system_id <> p_system_id
      and v_parent_system_source <> 'official'
      and v_parent_system_owner_id <> v_actor then
      raise exception 'External parent version is not readable by actor' using errcode = '42501';
    end if;
  end if;

  if p_inherit_art_style then
    v_effective_art_style := v_parent_version.art_style;
  else
    v_effective_art_style := p_art_style;
  end if;
  v_effective_content_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'document', p_document,
          'rules', p_rules,
          'artStyle', v_effective_art_style
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if p_idempotency_key is not null then
    select * into v_version
    from public.game_design_system_versions
    where system_id = p_system_id
      and idempotency_key = p_idempotency_key;
    if found then
      if not (
        v_version.parent_version_id is not distinct from p_parent_version_id
        and v_version.created_by = v_actor
        and v_version.document is not distinct from p_document
        and v_version.rules is not distinct from p_rules
        and v_version.art_style is not distinct from v_effective_art_style
      ) then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
      end if;
      return v_version;
    end if;
  end if;

  if p_generation_job_id is not null then
    select * into v_version
    from public.game_design_system_versions
    where generation_job_id = p_generation_job_id;
    if found then
      if v_version.system_id <> p_system_id
        or v_system.generation_job_id is distinct from p_generation_job_id then
        raise exception 'Generation job output does not match destination system'
          using errcode = '23514';
      end if;
      return v_version;
    end if;
  end if;

  if not (v_system.current_version_id is not distinct from p_expected_current_version_id) then
    raise exception 'VERSION_STALE' using errcode = 'P0001';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_version_number
  from public.game_design_system_versions
  where system_id = p_system_id;
  v_rendered_markdown := regexp_replace(
    p_rendered_markdown,
    '^> Version: __KECO_ATOMIC_VERSION_LINE__$',
    '> Version: ' || v_version_number::text,
    'n'
  );

  insert into public.game_design_system_versions (
    system_id, version_number, parent_version_id, document, art_style, rules, rendered_markdown,
    source_snapshots, diff, conflicts, content_hash, created_by, generation_job_id, idempotency_key
  ) values (
    p_system_id, v_version_number, p_parent_version_id, p_document, v_effective_art_style, p_rules, v_rendered_markdown,
    p_source_snapshots, p_diff, p_conflicts, v_effective_content_hash, v_actor, p_generation_job_id, p_idempotency_key
  ) returning * into v_version;

  update public.game_design_systems
  set current_version_id = v_version.id,
      body = v_rendered_markdown,
      genres = array(select jsonb_array_elements_text(p_rules -> 'genres')),
      philosophies = array(select jsonb_array_elements_text(p_rules -> 'philosophies')),
      suitable_for = p_rules ->> 'suitableFor'
  where id = p_system_id;

  return v_version;
end;
$$;

revoke all on function public.create_game_design_system_version(
  uuid, uuid, jsonb, jsonb, boolean, jsonb, text, jsonb, jsonb, jsonb, text, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.create_game_design_system_version(
  uuid, uuid, jsonb, jsonb, boolean, jsonb, text, jsonb, jsonb, jsonb, text, uuid, uuid, uuid, uuid
) to service_role;

notify pgrst, 'reload schema';
