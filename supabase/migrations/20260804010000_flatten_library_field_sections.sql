-- Flatten legacy field sections into one private compatibility group per library.
-- The repair function remains available for service-role emergency repair.

create or replace function public.normalize_library_field_sections(
  p_library_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Lock the rows before taking the ordering snapshot so concurrent writes cannot
  -- change the source section order while this operation is in progress.
  perform 1
  from public.library_field_definitions as field
  where p_library_id is null or field.library_id = p_library_id
  for update;

  -- A function can be called more than once in a transaction. Recreate the
  -- transaction-local snapshot rather than relying on an ON COMMIT cleanup.
  drop table if exists pg_temp.keco_flatten_library_fields;
  create temporary table keco_flatten_library_fields
  on commit drop
  as
  with section_order as (
    select
      field.library_id,
      field.section_id,
      min(field.order_index) as section_first_order,
      min(field.section) as section_name
    from public.library_field_definitions as field
    where p_library_id is null or field.library_id = p_library_id
    group by field.library_id, field.section_id
  )
  select
    field.id,
    field.library_id,
    section_order.section_first_order,
    section_order.section_name,
    field.order_index as legacy_order_index,
    (
      row_number() over (
        partition by field.library_id
        order by
          section_order.section_first_order,
          section_order.section_name,
          field.order_index,
          field.id
      ) - 1
    )::integer as flat_order
  from public.library_field_definitions as field
  join section_order
    on section_order.library_id = field.library_id
   and section_order.section_id = field.section_id
  where p_library_id is null or field.library_id = p_library_id;

  -- Move every row to a distinct negative position before changing section_id;
  -- this avoids transient conflicts with unique(section_id, order_index).
  update public.library_field_definitions as field
  set order_index = -(snapshot.flat_order + 1)
  from pg_temp.keco_flatten_library_fields as snapshot
  where field.id = snapshot.id;

  -- Preserve each field row (and therefore its cell values), changing only the
  -- compatibility section columns and the deterministic flattened position.
  update public.library_field_definitions as field
  set section = '__keco_flat_fields__',
      section_id = md5(field.library_id::text || '::keco-flat-fields'),
      order_index = snapshot.flat_order
  from pg_temp.keco_flatten_library_fields as snapshot
  where field.id = snapshot.id;
end;
$$;

revoke all on function public.normalize_library_field_sections(uuid)
  from public, anon, authenticated;
grant execute on function public.normalize_library_field_sections(uuid)
  to service_role;

select public.normalize_library_field_sections();
