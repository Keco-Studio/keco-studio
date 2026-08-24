create or replace function public.mcp_read_project_structure(p_project_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  with allowed as (
    select p.id, p.name, p.description, p.updated_at
    from public.projects p
    where p.id = p_project_id and public.mcp_current_project_role(p.id) is not null
  ), folders_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id,
      'projectId', f.project_id,
      'parentFolderId', f.parent_folder_id,
      'name', f.name,
      'updatedAt', f.updated_at
    ) order by f.name, f.id), '[]'::jsonb) value
    from public.folders f join allowed a on a.id = f.project_id
  ), tables_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'name', l.name, 'description', l.description,
      'folderId', l.folder_id, 'updatedAt', l.updated_at,
      'fields', coalesce((select jsonb_agg(jsonb_build_object(
        'id', fd.id, 'label', fd.label, 'dataType', fd.data_type,
        'section', fd.section, 'sectionId', fd.section_id,
        'description', fd.description, 'required', fd.required,
        'enumOptions', fd.enum_options, 'referenceTableIds', fd.reference_libraries,
        'orderIndex', fd.order_index
      ) order by fd.order_index, fd.id)
      from public.library_field_definitions fd where fd.library_id = l.id), '[]'::jsonb)
    ) order by l.name, l.id), '[]'::jsonb) value
    from public.libraries l join allowed a on a.id = l.project_id
  ), documents_json as (
    select coalesce(jsonb_agg(item.value order by item.updated_at desc, item.id desc), '[]'::jsonb) value
    from (
      select d.id, d.updated_at, jsonb_build_object(
        'id', d.id, 'name', d.name, 'folderId', d.folder_id,
        'updatedAt', d.updated_at, 'epoch', d.collab_epoch,
        'revision', d.collab_revision
      ) value
      from public.documents d join allowed a on a.id = d.project_id
      order by d.updated_at desc, d.id desc limit 200
    ) item
  )
  select jsonb_build_object(
    'project', jsonb_build_object('id', a.id, 'name', a.name,
      'description', a.description, 'updatedAt', a.updated_at),
    'folders', f.value, 'tables', t.value, 'documents', d.value
  )
  from allowed a cross join folders_json f cross join tables_json t cross join documents_json d
$$;

comment on function public.mcp_read_project_structure(uuid) is
  'Returns project structure with complete folder project and parent identities.';
