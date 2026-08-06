-- Return one transaction-consistent raw Script snapshot for MCP graph decoding.

create or replace function public.mcp_read_story_graph_snapshot(
  p_project_id uuid,
  p_library_id uuid
)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  with membership as (
    select p.id
    from public.projects p
    where p.id = p_project_id
      and public.mcp_current_project_role(p.id) is not null
  ), target_library as (
    select l.id, l.name, l.document_export_type, l.updated_at, l.plot_plan
    from public.libraries l
    join membership m on m.id = l.project_id
    where l.id = p_library_id
  ), relevant_fields as (
    select f.id, f.label, f.data_type, f.order_index
    from public.library_field_definitions f
    join target_library l on l.id = f.library_id
    where f.label in ('Label', 'Type', 'Name', 'Content', 'Commands')
       or f.label ~ '^Option[0-9]+(_Next|_Commands)?$'
  ), ordered_rows as (
    select a.id, a.name, a.row_index, a.created_at, a.updated_at
    from public.library_assets a
    join target_library l on l.id = a.library_id
    order by a.row_index nulls last, a.created_at, a.id
  )
  select case
    when not exists (select 1 from membership) then
      jsonb_build_object('status', 'access_denied')
    when not exists (select 1 from target_library) then null
    else (
      select jsonb_build_object(
        'status', 'ok',
        'library', jsonb_build_object(
          'id', l.id,
          'name', l.name,
          'documentExportType', l.document_export_type,
          'updatedAt', l.updated_at,
          'plotPlan', l.plot_plan
        ),
        'fields', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', f.id,
            'label', f.label,
            'dataType', f.data_type,
            'orderIndex', f.order_index
          ) order by f.order_index, f.id)
          from relevant_fields f
        ), '[]'::jsonb),
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', r.id,
            'name', r.name,
            'rowIndex', r.row_index,
            'createdAt', r.created_at,
            'updatedAt', r.updated_at,
            'values', coalesce((
              select jsonb_agg(jsonb_build_object(
                'fieldId', v.field_id,
                'value', v.value_json
              ) order by v.field_id)
              from public.library_asset_values v
              join relevant_fields f on f.id = v.field_id
              where v.asset_id = r.id
            ), '[]'::jsonb)
          ) order by r.row_index nulls last, r.created_at, r.id)
          from ordered_rows r
        ), '[]'::jsonb)
      )
      from target_library l
    )
  end
$$;

revoke all on function public.mcp_read_story_graph_snapshot(uuid, uuid)
  from public, anon;
grant execute on function public.mcp_read_story_graph_snapshot(uuid, uuid)
  to authenticated, service_role;

comment on function public.mcp_read_story_graph_snapshot(uuid, uuid) is
  'Returns raw story graph state for shared TypeScript decoding without exposing cross-project data.';
