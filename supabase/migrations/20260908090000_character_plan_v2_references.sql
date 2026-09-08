-- Add strict Character Plan V2 references without changing existing RPC signatures.

create or replace function public.character_validate_asset_plan_v1(p_plan jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_kind text;
  v_schema_version text;
  v_prompt text;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object'
    or p_plan ->> 'kind' not in ('character', 'animation')
    or jsonb_typeof(p_plan -> 'name') is distinct from 'string'
    or not (char_length(btrim(p_plan ->> 'name')) between 1 and 160) then
    raise exception 'invalid character asset plan' using errcode = '22023';
  end if;
  v_kind := p_plan ->> 'kind';
  v_schema_version := p_plan ->> 'schemaVersion';

  if v_kind = 'character' then
    if coalesce(v_schema_version, '') not in ('1', '2')
      or coalesce(p_plan ->> 'perspective', '') not in ('topdown', 'platformer', 'isometric')
      or coalesce(p_plan ->> 'facing', '') not in ('front', 'back', 'left', 'right')
      or (p_plan ->> 'width')::integer not in (32, 64, 96, 128)
      or (p_plan ->> 'height')::integer <> (p_plan ->> 'width')::integer
      or p_plan -> 'transparent' is distinct from 'true'::jsonb then
      raise exception 'invalid character plan' using errcode = '22023';
    end if;
    if v_schema_version = '1' and (
      not (p_plan ?& array['schemaVersion', 'kind', 'name', 'description', 'perspective', 'facing', 'width', 'height', 'transparent'])
      or p_plan - array['schemaVersion', 'kind', 'name', 'description', 'perspective', 'facing', 'width', 'height', 'transparent'] <> '{}'::jsonb
    ) then
      raise exception 'invalid character plan' using errcode = '22023';
    end if;
    if v_schema_version = '2' then
      if not (p_plan ?& array['schemaVersion', 'kind', 'name', 'description', 'perspective', 'facing', 'width', 'height', 'transparent', 'references'])
        or p_plan - array['schemaVersion', 'kind', 'name', 'description', 'perspective', 'facing', 'width', 'height', 'transparent', 'references'] <> '{}'::jsonb
        or jsonb_typeof(p_plan -> 'references') is distinct from 'array' then
        raise exception 'invalid character references' using errcode = '22023';
      end if;
      if jsonb_array_length(p_plan -> 'references') > 4
        or exists (
          select 1
          from jsonb_array_elements(p_plan -> 'references') as reference(value)
          where jsonb_typeof(reference.value) <> 'object'
            or not (reference.value ?& array['assetId', 'sha256', 'role', 'required', 'usage'])
            or reference.value - array['assetId', 'sha256', 'role', 'required', 'usage'] <> '{}'::jsonb
            or coalesce(reference.value ->> 'assetId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            or coalesce(reference.value ->> 'sha256', '') !~ '^[a-f0-9]{64}$'
            or jsonb_typeof(reference.value -> 'role') is distinct from 'string'
            or coalesce(reference.value ->> 'role', '') not in ('style', 'source')
            or jsonb_typeof(reference.value -> 'required') is distinct from 'boolean'
            or jsonb_typeof(reference.value -> 'usage') is distinct from 'string'
            or not (char_length(btrim(reference.value ->> 'usage')) between 1 and 240)
        )
        or exists (
          select 1
          from jsonb_array_elements(p_plan -> 'references') as reference(value)
          group by reference.value ->> 'assetId'
          having count(*) > 1
        ) then
        raise exception 'invalid character references' using errcode = '22023';
      end if;
    end if;
    v_prompt := p_plan ->> 'description';
  else
    if v_schema_version is distinct from '1'
      or not (p_plan ?& array['schemaVersion', 'kind', 'name', 'sourceCharacterAssetId', 'sourceCharacterSha256', 'motionDescription', 'frameWidth', 'frameHeight', 'frameCount', 'fps', 'loop'])
      or p_plan - array['schemaVersion', 'kind', 'name', 'sourceCharacterAssetId', 'sourceCharacterSha256', 'motionDescription', 'frameWidth', 'frameHeight', 'frameCount', 'fps', 'loop'] <> '{}'::jsonb
      or coalesce(p_plan ->> 'sourceCharacterAssetId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(p_plan ->> 'sourceCharacterSha256', '') !~ '^[a-f0-9]{64}$'
      or not ((p_plan ->> 'frameWidth')::integer between 16 and 256)
      or ((p_plan ->> 'frameWidth')::integer % 4) <> 0
      or not ((p_plan ->> 'frameHeight')::integer between 16 and 256)
      or ((p_plan ->> 'frameHeight')::integer % 4) <> 0
      or not ((p_plan ->> 'frameCount')::integer between 4 and 16)
      or ((p_plan ->> 'frameCount')::integer % 2) <> 0
      or not ((p_plan ->> 'fps')::integer between 1 and 60)
      or jsonb_typeof(p_plan -> 'loop') is distinct from 'boolean' then
      raise exception 'invalid animation plan' using errcode = '22023';
    end if;
    v_prompt := p_plan ->> 'motionDescription';
  end if;

  if v_prompt is null or not (char_length(v_prompt) between 1 and 2000)
    or char_length(btrim(v_prompt)) = 0
    or v_prompt ~* 'https://|http://|www\.'
    or v_prompt ~* '\y(?:pixellab|mcp|api|create_character|animate_character|animate_image|animate_with_text)\y'
    or v_prompt ~* '\y(?:api\s*key|authorization|bearer|password|token)\y\s*[:=]?' then
    raise exception 'unsafe character asset prompt' using errcode = '22023';
  end if;
end;
$$;

notify pgrst, 'reload schema';
