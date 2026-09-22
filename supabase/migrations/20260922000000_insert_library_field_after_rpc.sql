create or replace function public.insert_library_field_after(
  p_library_id uuid,
  p_after_field_id uuid,
  p_label text,
  p_data_type text,
  p_description text default null,
  p_required boolean default false,
  p_enum_options text[] default null,
  p_reference_libraries uuid[] default null,
  p_formula_expression text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_library public.libraries%rowtype;
  v_after_field public.library_field_definitions%rowtype;
  v_actor uuid := auth.uid();
  v_insert_index integer;
  v_field_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_library
  from public.libraries
  where id = p_library_id
  for update;
  if not found then
    raise exception 'Table not found' using errcode = 'P0002';
  end if;
  if not (
    public.is_project_owner(v_library.project_id, v_actor)
    or public.is_editor_or_admin_collaborator(v_library.project_id, v_actor)
  ) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;

  select * into v_after_field
  from public.library_field_definitions
  where id = p_after_field_id
    and library_id = p_library_id
  for update;
  if not found then
    raise exception 'Column not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.library_field_definitions
  where library_id = p_library_id
  for update;

  drop table if exists pg_temp.keco_insert_field_order;
  create temporary table keco_insert_field_order
  on commit drop
  as
  select
    field.id,
    (row_number() over (order by field.order_index, field.id) - 1)::integer as position
  from public.library_field_definitions as field
  where field.library_id = p_library_id;

  select position + 1 into v_insert_index
  from pg_temp.keco_insert_field_order
  where id = p_after_field_id;

  update public.library_field_definitions as field
  set order_index = -(snapshot.position + 1)
  from pg_temp.keco_insert_field_order as snapshot
  where field.id = snapshot.id;

  insert into public.library_field_definitions (
    library_id,
    section_id,
    section,
    label,
    description,
    data_type,
    formula_expression,
    required,
    order_index,
    enum_options,
    reference_libraries
  ) values (
    p_library_id,
    v_after_field.section_id,
    v_after_field.section,
    btrim(p_label),
    nullif(btrim(coalesce(p_description, '')), ''),
    p_data_type,
    case when p_data_type = 'formula' then nullif(btrim(coalesce(p_formula_expression, '')), '') else null end,
    coalesce(p_required, false),
    v_insert_index,
    case when p_data_type = 'enum' then coalesce(p_enum_options, '{}'::text[]) else null end,
    case when p_data_type = 'reference' then coalesce(p_reference_libraries, '{}'::uuid[]) else null end
  ) returning id into v_field_id;

  update public.library_field_definitions as field
  set order_index = case
    when snapshot.position >= v_insert_index then snapshot.position + 1
    else snapshot.position
  end
  from pg_temp.keco_insert_field_order as snapshot
  where field.id = snapshot.id;

  update public.libraries
  set updated_at = now(), updated_by = v_actor
  where id = p_library_id;
  update public.projects set updated_at = now() where id = v_library.project_id;
  if v_library.folder_id is not null then
    update public.folders set updated_at = now() where id = v_library.folder_id;
  end if;

  return v_field_id;
end;
$$;

revoke all on function public.insert_library_field_after(uuid, uuid, text, text, text, boolean, text[], uuid[], text) from public, anon;
grant execute on function public.insert_library_field_after(uuid, uuid, text, text, text, boolean, text[], uuid[], text) to authenticated;
