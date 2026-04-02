-- Table cell global search: same fuzzy rule as project/folder/library (normalizeSearchString).
-- Strip spaces/underscores on both query and cell text so "cat hh" matches "cathh".

drop function if exists public.search_library_cell_values(text, integer);

create function public.search_library_cell_values(
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
    select
      trim(p_query) as query_raw,
      nullif(
        regexp_replace(lower(trim(p_query)), '[[:space:]_]+', '', 'g'),
        ''
      ) as query_norm
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
      and (select query_norm from q) is not null
      and regexp_replace(lower(lav.value_json::text), '[[:space:]_]+', '', 'g')
          like '%' || (select query_norm from q) || '%'
  )
  select
    c.project_id,
    c.library_id,
    c.library_name,
    c.asset_id,
    c.asset_name,
    c.section_id,
    c.field_id,
    c.field_label,
    substring(
      c.value_text_full
      from greatest(
        case
          when position(lower((select query_raw from q)) in lower(c.value_text_full)) > 0
          then position(lower((select query_raw from q)) in lower(c.value_text_full)) - 40
          else 0
        end,
        1
      )
      for 160
    ) as value_snippet,
    c.asset_updated_at
  from candidates c
  order by c.asset_updated_at desc
  limit greatest(p_limit, 1);
$$;
