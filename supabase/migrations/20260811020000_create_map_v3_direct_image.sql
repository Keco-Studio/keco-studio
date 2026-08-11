-- Create Map V3 direct-image revisions and private uploaded reference registry.

alter table public.map_revisions
  drop constraint if exists map_revisions_schema_version_check;
alter table public.map_revisions
  add constraint map_revisions_schema_version_check
  check (schema_version in (1, 2, 3));

alter table public.map_revisions
  drop constraint if exists map_revisions_source_tuple_check;
alter table public.map_revisions
  add constraint map_revisions_source_tuple_check check (
    (
      schema_version = 1
      and source_document_id is not null
      and source_document_updated_at is not null
      and source_epoch is not null
      and source_revision is not null
    )
    or (
      schema_version in (2, 3)
      and (
        (
          source_document_id is null
          and source_document_updated_at is null
          and source_epoch is null
          and source_revision is null
        )
        or (
          source_document_id is not null
          and source_document_updated_at is not null
          and source_epoch is not null
          and source_revision is not null
        )
      )
    )
  );

alter table public.map_assets
  drop constraint if exists map_assets_kind_check;
alter table public.map_assets
  add constraint map_assets_kind_check
  check (kind in ('terrain', 'road', 'object', 'inpaint', 'path', 'obstacle', 'background', 'map_image'));

create table public.map_reference_images (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  width integer not null check (width > 0 and width <= 2048),
  height integer not null check (height > 0 and height <= 2048),
  content_type text not null check (content_type = 'image/png'),
  byte_size integer not null check (byte_size > 0 and byte_size <= 5242880),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.map_reference_images enable row level security;

create policy map_reference_images_select
  on public.map_reference_images for select using (
    exists (
      select 1 from public.projects p
      where p.id = map_reference_images.project_id
        and (
          p.owner_id = (select auth.uid())
          or exists (
            select 1 from public.project_collaborators c
            where c.project_id = p.id
              and c.user_id = (select auth.uid())
              and c.accepted_at is not null
          )
        )
    )
  );

revoke all on public.map_reference_images from public, anon, authenticated;
grant select on public.map_reference_images to authenticated;

create function public.map_validate_v3_payload(p_plan jsonb, p_scene jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_plan is null
    or p_scene is null
    or jsonb_typeof(p_plan) <> 'object'
    or jsonb_typeof(p_scene) <> 'object'
    or jsonb_typeof(p_plan -> 'schemaVersion') is distinct from 'number'
    or jsonb_typeof(p_scene -> 'schemaVersion') is distinct from 'number'
    or p_plan ->> 'schemaVersion' <> '3'
    or p_scene ->> 'schemaVersion' <> '3' then
    raise exception 'V3 plan and scene payloads are required' using errcode = '22023';
  end if;

  if jsonb_typeof(p_plan -> 'name') is distinct from 'string'
    or not (char_length(btrim(p_plan ->> 'name')) between 1 and 160)
    or jsonb_typeof(p_plan -> 'summary') is distinct from 'string'
    or not (char_length(btrim(p_plan ->> 'summary')) between 1 and 500) then
    raise exception 'invalid V3 plan summary' using errcode = '22023';
  end if;

  if jsonb_typeof(p_plan -> 'map') is distinct from 'object'
    or jsonb_typeof(p_plan #> '{map,width}') is distinct from 'number'
    or jsonb_typeof(p_plan #> '{map,height}') is distinct from 'number' then
    raise exception 'V3 map dimensions are required' using errcode = '22023';
  end if;
  if (
    (p_plan #>> '{map,width}')::numeric,
    (p_plan #>> '{map,height}')::numeric
  ) not in ((512, 512), (688, 384), (384, 688)) then
    raise exception 'unsupported V3 map dimensions' using errcode = '22023';
  end if;

  if jsonb_typeof(p_plan -> 'description') is distinct from 'string'
    or not (char_length(p_plan ->> 'description') between 1 and 2000)
    or char_length(btrim(p_plan ->> 'description')) = 0 then
    raise exception 'invalid V3 map description' using errcode = '22023';
  end if;
  if p_plan ->> 'description' ~* 'https://|http://|www\.'
    or p_plan ->> 'description' ~* '\ydata:'
    or p_plan ->> 'description' ~* '\y(?:api\s+key|authorization|bearer|password|token)\y\s*[:=]'
    or p_plan ->> 'description' ~* '\y(?:create_image_pro|get_image|pixellab|mcp|api)\y'
    or p_plan ->> 'description' ~* '\y(?:current|live|active|selected|visible)\s+(?:keco\s+)?(?:button|label|ui|user\s+interface|screen|panel|menu|control|dialog|header|title|status|text|copy)\y'
    or p_plan ->> 'description' ~* '\y(?:button|label|ui|user\s+interface|screen|panel|menu|control|dialog|header|title|status|text|copy)\y.{0,48}\y(?:current|live|active|selected|visible)\s+(?:keco\y)?' then
    raise exception 'unsafe V3 map description' using errcode = '22023';
  end if;

  if jsonb_typeof(p_plan -> 'generation') is distinct from 'object'
    or p_plan #>> '{generation,provider}' <> 'pixellab'
    or p_plan #>> '{generation,operation}' <> 'create_image_pro'
    or p_plan #> '{generation,noBackground}' is null
    or p_plan #> '{generation,noBackground}' <> 'false'::jsonb then
    raise exception 'invalid V3 generation contract' using errcode = '22023';
  end if;
  if (case jsonb_typeof(p_plan #> '{generation,seed}')
      when 'null' then false
      when 'number' then
        (p_plan #>> '{generation,seed}')::numeric < 0
        or (p_plan #>> '{generation,seed}')::numeric <> trunc((p_plan #>> '{generation,seed}')::numeric)
      else true
    end) then
    raise exception 'invalid V3 generation seed' using errcode = '22023';
  end if;

  if jsonb_typeof(p_plan -> 'references') is distinct from 'array'
    or jsonb_array_length(p_plan -> 'references') > 4 then
    raise exception 'invalid V3 content references' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_plan -> 'references') as reference(value)
    where jsonb_typeof(reference.value) <> 'object'
      or coalesce(reference.value ->> 'assetId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(reference.value ->> 'sha256', '') !~ '^[a-f0-9]{64}$'
      or coalesce(reference.value ->> 'role', '') not in ('content', 'layout')
      or not (char_length(btrim(coalesce(reference.value ->> 'usage', ''))) between 1 and 240)
  ) then
    raise exception 'invalid V3 content reference' using errcode = '22023';
  end if;

  if jsonb_typeof(p_plan -> 'styleReference') not in ('null', 'object')
    or p_plan -> 'styleReference' is null then
    raise exception 'invalid V3 style reference' using errcode = '22023';
  end if;
  if jsonb_typeof(p_plan -> 'styleReference') = 'object' then
    if coalesce(p_plan #>> '{styleReference,assetId}', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(p_plan #>> '{styleReference,sha256}', '') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(p_plan #> '{styleReference,copy}') is distinct from 'array' then
      raise exception 'invalid V3 style reference' using errcode = '22023';
    end if;
    if jsonb_array_length(p_plan #> '{styleReference,copy}') not between 1 and 4
      or exists (
        select 1
        from jsonb_array_elements_text(p_plan #> '{styleReference,copy}') as copied(value)
        where copied.value not in ('color_palette', 'outline', 'detail', 'shading')
      )
      or (
        select count(distinct copied.value)
        from jsonb_array_elements_text(p_plan #> '{styleReference,copy}') as copied(value)
      ) <> jsonb_array_length(p_plan #> '{styleReference,copy}') then
      raise exception 'invalid V3 style reference' using errcode = '22023';
    end if;
  end if;

  if jsonb_typeof(p_scene -> 'size') is distinct from 'object'
    or jsonb_typeof(p_scene #> '{size,width}') is distinct from 'number'
    or jsonb_typeof(p_scene #> '{size,height}') is distinct from 'number' then
    raise exception 'V3 scene dimensions are required' using errcode = '22023';
  end if;
  if (p_scene #>> '{size,width}')::numeric <> (p_plan #>> '{map,width}')::numeric
    or (p_scene #>> '{size,height}')::numeric <> (p_plan #>> '{map,height}')::numeric then
    raise exception 'V3 scene dimensions must match the plan' using errcode = '22023';
  end if;
end;
$$;

create function public.create_map_project_v3(
  p_project_id uuid,
  p_name text,
  p_source_document_id uuid,
  p_source_document_updated_at timestamptz,
  p_source_epoch bigint,
  p_source_revision bigint,
  p_plan jsonb,
  p_scene jsonb
)
returns table (map_id uuid, draft_revision_id uuid, revision_number bigint, save_version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_map_id uuid := gen_random_uuid();
  v_revision_id uuid := gen_random_uuid();
begin
  v_user_id := public.map_require_writer(p_project_id);
  perform public.map_validate_v3_payload(p_plan, p_scene);

  if not (
    (p_source_document_id is null and p_source_document_updated_at is null and p_source_epoch is null and p_source_revision is null)
    or
    (p_source_document_id is not null and p_source_document_updated_at is not null and p_source_epoch is not null and p_source_revision is not null)
  ) then
    raise exception 'source context must be entirely absent or complete' using errcode = '22023';
  end if;
  if p_source_document_id is not null and not exists (
    select 1 from public.documents
    where id = p_source_document_id and project_id = p_project_id
  ) then
    raise exception 'source document does not belong to project' using errcode = '23503';
  end if;

  insert into public.map_projects (id, project_id, name, created_by)
  values (v_map_id, p_project_id, btrim(p_name), v_user_id);

  insert into public.map_revisions (
    id, map_project_id, revision_number, save_version, parent_revision_id,
    source_document_id, source_document_updated_at, source_epoch, source_revision,
    schema_version, plan, scene, status, created_by
  ) values (
    v_revision_id, v_map_id, 1, 0, null,
    p_source_document_id, p_source_document_updated_at, p_source_epoch, p_source_revision,
    3, p_plan, p_scene, 'draft', v_user_id
  );

  update public.map_projects
  set current_revision_id = v_revision_id, updated_at = now()
  where id = v_map_id;
  return query select v_map_id, v_revision_id, 1::bigint, 0::bigint;
end;
$$;

create function public.save_map_draft_v3(
  p_map_id uuid,
  p_revision_id uuid,
  p_expected_save_version bigint,
  p_plan jsonb,
  p_scene jsonb
)
returns table (status text, save_version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map public.map_projects%rowtype;
  v_save_version bigint;
begin
  select * into v_map from public.map_projects where id = p_map_id for update;
  if not found then raise exception 'map not found' using errcode = 'P0002'; end if;
  perform public.map_require_writer(v_map.project_id);
  perform public.map_validate_v3_payload(p_plan, p_scene);

  update public.map_revisions as revision
  set plan = p_plan,
      scene = p_scene,
      save_version = revision.save_version + 1
  where revision.id = p_revision_id
    and revision.map_project_id = p_map_id
    and revision.schema_version = 3
    and revision.status = 'draft'
    and revision.save_version = p_expected_save_version
    and exists (
      select 1 from public.map_projects
      where id = p_map_id and current_revision_id = p_revision_id
    )
  returning revision.save_version into v_save_version;

  if v_save_version is null then
    return query select 'conflict'::text, null::bigint;
    return;
  end if;

  update public.map_projects
  set name = btrim(p_plan ->> 'name'), updated_at = now()
  where id = p_map_id;
  return query select 'saved'::text, v_save_version;
end;
$$;

create function public.publish_map_revision_v3(
  p_map_id uuid,
  p_draft_revision_id uuid,
  p_expected_save_version bigint
)
returns table (status text, published_revision_id uuid, next_draft_revision_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map public.map_projects%rowtype;
  v_draft public.map_revisions%rowtype;
  v_user_id uuid;
  v_next_revision_id uuid := gen_random_uuid();
  v_next_revision_number bigint;
begin
  select * into v_map from public.map_projects where id = p_map_id for update;
  if not found then raise exception 'map not found' using errcode = 'P0002'; end if;
  v_user_id := public.map_require_writer(v_map.project_id);
  if v_map.current_revision_id is distinct from p_draft_revision_id then
    return query select 'conflict'::text, null::uuid, null::uuid;
    return;
  end if;

  select * into v_draft
  from public.map_revisions
  where id = p_draft_revision_id
    and map_project_id = p_map_id
    and schema_version = 3
  for update;
  if not found or v_draft.status <> 'draft' or v_draft.save_version <> p_expected_save_version then
    return query select 'conflict'::text, null::uuid, null::uuid;
    return;
  end if;
  perform public.map_validate_v3_payload(v_draft.plan, v_draft.scene);

  update public.map_revisions
  set status = 'generating'
  where id = v_draft.id and schema_version = 3;
  select coalesce(max(revision.revision_number), 0) + 1 into v_next_revision_number
  from public.map_revisions as revision
  where revision.map_project_id = p_map_id and revision.schema_version = 3;

  insert into public.map_revisions (
    id, map_project_id, revision_number, save_version, parent_revision_id,
    source_document_id, source_document_updated_at, source_epoch, source_revision,
    schema_version, plan, scene, status, created_by
  ) values (
    v_next_revision_id, p_map_id, v_next_revision_number, 0, v_draft.id,
    v_draft.source_document_id, v_draft.source_document_updated_at,
    v_draft.source_epoch, v_draft.source_revision, 3,
    v_draft.plan, v_draft.scene, 'draft', v_user_id
  );
  update public.map_projects
  set current_revision_id = v_next_revision_id, updated_at = now()
  where id = p_map_id;
  return query select 'published'::text, v_draft.id, v_next_revision_id;
end;
$$;

create function public.create_map_asset_plan_v3(
  p_revision_id uuid,
  p_generation_id uuid,
  p_plan_fingerprint text
)
returns table (asset_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision public.map_revisions%rowtype;
  v_project_id uuid;
  v_asset public.map_assets%rowtype;
  v_reference public.map_reference_images%rowtype;
  v_reference_ids uuid[] := '{}'::uuid[];
  v_reference_hashes text[] := '{}'::text[];
  v_index integer;
  v_asset_key text;
  v_kind text;
  v_capability text;
  v_prompt text;
  v_generation_params jsonb;
begin
  v_asset_key := 'map-image';
  v_kind := 'map_image';
  v_capability := 'direct_map_image';

  select revision.* into v_revision
  from public.map_revisions as revision
  where revision.id = p_revision_id and revision.schema_version = 3
  for update;
  if not found then raise exception 'V3 revision not found' using errcode = 'P0002'; end if;

  select map.project_id into v_project_id
  from public.map_projects as map
  where map.id = v_revision.map_project_id;
  perform public.map_require_writer(v_project_id);
  if v_revision.status not in ('generating', 'partial', 'failed', 'ready') then
    raise exception 'revision is not accepting asset plans' using errcode = '23514';
  end if;
  if p_generation_id is null then
    raise exception 'generation identity is required' using errcode = '22023';
  end if;
  if p_plan_fingerprint is null or p_plan_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid plan fingerprint' using errcode = '22023';
  end if;
  perform public.map_validate_v3_payload(v_revision.plan, v_revision.scene);

  v_prompt := v_revision.plan ->> 'description';
  v_generation_params := jsonb_build_object(
    'width', (v_revision.plan #>> '{map,width}')::integer,
    'height', (v_revision.plan #>> '{map,height}')::integer,
    'noBackground', false,
    'seed', v_revision.plan #> '{generation,seed}',
    'references', coalesce(v_revision.plan -> 'references', '[]'::jsonb),
    'styleReference', v_revision.plan -> 'styleReference'
  );

  select
    coalesce(array_agg((reference.value ->> 'assetId')::uuid order by reference.ordinality), '{}'::uuid[]),
    coalesce(array_agg(reference.value ->> 'sha256' order by reference.ordinality), '{}'::text[])
  into v_reference_ids, v_reference_hashes
  from jsonb_array_elements(coalesce(v_revision.plan -> 'references', '[]'::jsonb))
    with ordinality as reference(value, ordinality);

  if jsonb_typeof(v_revision.plan -> 'styleReference') = 'object' then
    v_reference_ids := array_append(v_reference_ids, (v_revision.plan #>> '{styleReference,assetId}')::uuid);
    v_reference_hashes := array_append(v_reference_hashes, v_revision.plan #>> '{styleReference,sha256}');
  end if;

  if cardinality(v_reference_ids) <> cardinality(v_reference_hashes) then
    raise exception 'reference id and hash counts differ' using errcode = '22023';
  end if;
  if cardinality(v_reference_ids) <> (
    select count(distinct reference_id) from unnest(v_reference_ids) as reference_id
  ) then
    raise exception 'duplicate reference assets' using errcode = '22023';
  end if;

  for v_index in 1..cardinality(v_reference_ids) loop
    select reference.* into v_reference
    from public.map_reference_images as reference
    where reference.id = v_reference_ids[v_index]
    for key share;
    if not found then
      raise exception 'reference image not found' using errcode = '22023';
    end if;
    if v_reference.project_id <> v_project_id then
      raise exception 'reference image belongs to another project' using errcode = '22023';
    end if;
    if v_reference.sha256 <> v_reference_hashes[v_index] then
      raise exception 'reference image sha256 mismatch' using errcode = '22023';
    end if;
  end loop;

  insert into public.map_assets (
    map_revision_id, generation_id, asset_key, kind, status,
    requested_capability, prompt, generation_params, reference_asset_ids,
    reference_hashes, plan_fingerprint, metadata
  ) values (
    p_revision_id, p_generation_id, v_asset_key, v_kind, 'planned',
    v_capability, v_prompt, v_generation_params, v_reference_ids,
    v_reference_hashes, p_plan_fingerprint, '{}'::jsonb
  )
  on conflict (map_revision_id, asset_key) do nothing
  returning * into v_asset;

  if v_asset.id is null then
    select * into v_asset from public.map_assets
    where map_revision_id = p_revision_id and asset_key = v_asset_key;
    if v_asset.generation_id is distinct from p_generation_id
      or v_asset.kind is distinct from v_kind
      or v_asset.prompt is distinct from v_prompt
      or v_asset.requested_capability is distinct from v_capability
      or v_asset.generation_params is distinct from v_generation_params
      or v_asset.reference_asset_ids is distinct from v_reference_ids
      or v_asset.reference_hashes is distinct from v_reference_hashes
      or v_asset.plan_fingerprint is distinct from p_plan_fingerprint then
      raise exception 'asset key already has a different immutable V3 plan' using errcode = '23505';
    end if;
  end if;
  return query select v_asset.id, v_asset.status;
end;
$$;

revoke all on function public.map_validate_v3_payload(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.create_map_project_v3(uuid, text, uuid, timestamptz, bigint, bigint, jsonb, jsonb) from public, anon;
revoke all on function public.save_map_draft_v3(uuid, uuid, bigint, jsonb, jsonb) from public, anon;
revoke all on function public.publish_map_revision_v3(uuid, uuid, bigint) from public, anon;
revoke all on function public.create_map_asset_plan_v3(uuid, uuid, text) from public, anon;

grant execute on function public.create_map_project_v3(uuid, text, uuid, timestamptz, bigint, bigint, jsonb, jsonb) to authenticated;
grant execute on function public.save_map_draft_v3(uuid, uuid, bigint, jsonb, jsonb) to authenticated;
grant execute on function public.publish_map_revision_v3(uuid, uuid, bigint) to authenticated;
grant execute on function public.create_map_asset_plan_v3(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
