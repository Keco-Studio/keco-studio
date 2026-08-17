-- Preserve user-authored marker-like content and immutable generation provenance.

alter table public.game_design_system_versions
  drop constraint if exists game_design_system_versions_generation_job_id_fkey;

alter table public.game_design_system_versions
  add constraint game_design_system_versions_generation_job_id_fkey
  foreign key (generation_job_id)
  references public.game_design_system_generation_jobs(id)
  on delete restrict;

create or replace function public.create_game_design_system_version(
  p_system_id uuid,
  p_parent_version_id uuid,
  p_rules jsonb,
  p_rendered_markdown text,
  p_source_snapshots jsonb,
  p_diff jsonb,
  p_conflicts jsonb,
  p_content_hash text,
  p_created_by uuid,
  p_generation_job_id uuid
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

  if p_generation_job_id is not null then
    select * into v_version
    from public.game_design_system_versions
    where generation_job_id = p_generation_job_id;
    if found then
      if v_version.system_id <> p_system_id then
        raise exception 'Generation job output belongs to another system' using errcode = '23514';
      end if;
      update public.game_design_systems
      set current_version_id = v_version.id,
          body = v_version.rendered_markdown,
          genres = array(select jsonb_array_elements_text(v_version.rules -> 'genres')),
          philosophies = array(select jsonb_array_elements_text(v_version.rules -> 'philosophies')),
          suitable_for = v_version.rules ->> 'suitableFor'
      where id = p_system_id;
      return v_version;
    end if;
  end if;

  if p_parent_version_id is not null then
    select parent_system.id, parent_system.source, parent_system.owner_id
    into v_parent_system_id, v_parent_system_source, v_parent_system_owner_id
    from public.game_design_system_versions parent_version
    join public.game_design_systems parent_system on parent_system.id = parent_version.system_id
    where parent_version.id = p_parent_version_id;
    if not found then raise exception 'Parent version not found' using errcode = '23514'; end if;
    if v_parent_system_id <> p_system_id
      and v_parent_system_source <> 'official'
      and v_parent_system_owner_id <> v_actor then
      raise exception 'External parent version is not readable by actor' using errcode = '42501';
    end if;
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
    system_id, version_number, parent_version_id, rules, rendered_markdown,
    source_snapshots, diff, conflicts, content_hash, created_by, generation_job_id
  ) values (
    p_system_id, v_version_number, p_parent_version_id, p_rules, v_rendered_markdown,
    p_source_snapshots, p_diff, p_conflicts, p_content_hash, v_actor, p_generation_job_id
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
  uuid, uuid, jsonb, text, jsonb, jsonb, jsonb, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.create_game_design_system_version(
  uuid, uuid, jsonb, text, jsonb, jsonb, jsonb, text, uuid, uuid
) to service_role;

notify pgrst, 'reload schema';
