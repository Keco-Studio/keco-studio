-- Global search over library cell values
-- Used by /api/search/cell-values

create or replace function public.search_library_cell_values(
  p_query text,
  p_limit int default 30
)
returns table (
  project_id uuid,
  library_id uuid,
  library_name text,
  asset_id uuid,
  asset_name text,
  section_id text,
  field_id uuid,
  field_label text,
  value_snippet text,
  asset_updated_at timestamptz
)
language sql
security invoker
as $$
  with q as (
    select trim(p_query) as query
  ),
  candidates as (
    select
      l.project_id,
      l.id as library_id,
      l.name as library_name,
      la.id as asset_id,
      la.name as asset_name,
      lav.field_id as field_id,
      coalesce(lfd.label, '') as field_label,
      -- Must match frontend's SectionConfig.id format: `${library_id}:${sectionName}`
      (lfd.library_id::text || ':' || coalesce(lfd.section, '')) as section_id,
      lav.value_json::text as value_text_full,
      la.updated_at as asset_updated_at
    from public.library_asset_values lav
    join public.library_assets la
      on la.id = lav.asset_id
    join public.libraries l
      on l.id = la.library_id
    left join public.library_field_definitions lfd
      on lfd.id = lav.field_id
    where lav.value_json is not null
      and lav.value_json::text ilike ('%' || (select query from q) || '%')
  )
  select
    project_id,
    library_id,
    library_name,
    asset_id,
    asset_name,
    section_id,
    field_id,
    field_label,
    -- Produce a snippet around the first match (case-insensitive).
    substring(
      value_text_full
      from greatest(position(lower((select query from q)) in lower(value_text_full)) - 40, 1)
      for 160
    ) as value_snippet,
    asset_updated_at
  from candidates
  order by asset_updated_at desc
  limit greatest(p_limit, 1);
$$;

