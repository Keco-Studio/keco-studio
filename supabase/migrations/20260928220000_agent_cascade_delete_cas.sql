-- Approval snapshots include the complete FK closure of the rows a cascade can
-- remove, including document collaboration data and library cell values.
create function private.agent_cascade_delete_snapshot(
  p_project_id uuid, p_folder_id uuid default null, p_lock boolean default false
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_fk record;
  v_table record;
  v_join text;
  v_added integer;
  v_total integer;
  v_changed boolean;
  v_lock text := case when p_lock then ' for update of child' else '' end;
  v_payload jsonb;
begin
  if p_project_id is null then
    raise exception 'Project is required' using errcode = '22023';
  end if;

  create temporary table agent_cascade_delete_rows (
    relid oid not null, row_tid tid not null, payload jsonb not null,
    primary key (relid, row_tid)
  ) on commit drop;

  if p_folder_id is null then
    execute 'insert into pg_temp.agent_cascade_delete_rows
      select project.tableoid, project.ctid, to_jsonb(project)
      from public.projects project where project.id = $1'
      || case when p_lock then ' for update of project' else '' end
      using p_project_id;
    get diagnostics v_added = row_count;
    if v_added = 0 then raise exception 'Project not found' using errcode = 'P0002'; end if;

    -- Include project-scoped rows even when their FK uses SET NULL rather than
    -- CASCADE (for example, registered storage files).
    for v_table in
      select c.oid, n.nspname, c.relname
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = c.oid
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and a.attname = 'project_id' and not a.attisdropped
        and a.atttypid = 'uuid'::pg_catalog.regtype
        and c.relname <> 'projects'
      order by c.oid
    loop
      execute pg_catalog.format(
        'with selected as (select child.tableoid relid, child.ctid tid, to_jsonb(child) payload
           from %I.%I child where child.project_id = $1%s)
         insert into pg_temp.agent_cascade_delete_rows select * from selected on conflict do nothing',
        v_table.nspname, v_table.relname, v_lock
      ) using p_project_id;
    end loop;
  else
    execute 'insert into pg_temp.agent_cascade_delete_rows
      select folder.tableoid, folder.ctid, to_jsonb(folder)
      from public.folders folder where folder.id = $1 and folder.project_id = $2'
      || case when p_lock then ' for update of folder' else '' end
      using p_folder_id, p_project_id;
    get diagnostics v_added = row_count;
    if v_added = 0 then raise exception 'Folder not found' using errcode = 'P0002'; end if;
  end if;

  -- Walk incoming FKs until no more rows are reachable. Locking each parent
  -- FOR UPDATE also blocks new FK children while the approved state is checked.
  loop
    v_changed := false;
    for v_fk in
      select con.oid, con.conrelid, con.confrelid, con.conkey, con.confkey,
        child_ns.nspname child_schema, child_table.relname child_table,
        parent_ns.nspname parent_schema, parent_table.relname parent_table
      from pg_catalog.pg_constraint con
      join pg_catalog.pg_class child_table on child_table.oid = con.conrelid
      join pg_catalog.pg_namespace child_ns on child_ns.oid = child_table.relnamespace
      join pg_catalog.pg_class parent_table on parent_table.oid = con.confrelid
      join pg_catalog.pg_namespace parent_ns on parent_ns.oid = parent_table.relnamespace
      where con.contype = 'f' and child_ns.nspname = 'public'
        and parent_ns.nspname = 'public'
      order by con.confrelid, con.conrelid, con.oid
    loop
      select pg_catalog.string_agg(
        pg_catalog.format('child.%I = parent.%I', child_attr.attname, parent_attr.attname),
        ' and ' order by child_keys.ordinality
      ) into v_join
      from pg_catalog.unnest(v_fk.conkey) with ordinality as child_keys(child_no, ordinality)
      join pg_catalog.unnest(v_fk.confkey) with ordinality as parent_keys(parent_no, ordinality)
        using (ordinality)
      join pg_catalog.pg_attribute child_attr
        on child_attr.attrelid = v_fk.conrelid and child_attr.attnum = child_keys.child_no
      join pg_catalog.pg_attribute parent_attr
        on parent_attr.attrelid = v_fk.confrelid and parent_attr.attnum = parent_keys.parent_no;

      execute pg_catalog.format(
        'with selected as (select child.tableoid relid, child.ctid tid, to_jsonb(child) payload
          from %I.%I child join %I.%I parent on %s
          join pg_temp.agent_cascade_delete_rows selected_parent
            on selected_parent.relid = parent.tableoid and selected_parent.row_tid = parent.ctid%s)
         insert into pg_temp.agent_cascade_delete_rows select * from selected on conflict do nothing',
        v_fk.child_schema, v_fk.child_table, v_fk.parent_schema, v_fk.parent_table,
        v_join, v_lock
      );
      get diagnostics v_added = row_count;
      if v_added > 0 then v_changed := true; end if;
    end loop;

    if p_folder_id is not null then
      -- The document-delete trigger deletes entire Create Map projects when
      -- any revision references a deleted document.
      execute 'with selected as (
        select map_project.tableoid relid, map_project.ctid tid, to_jsonb(map_project) payload
        from public.map_projects map_project
        where exists (
          select 1 from public.map_revisions revision
          join public.documents document on document.id = revision.source_document_id
          join pg_temp.agent_cascade_delete_rows selected_document
            on selected_document.relid = document.tableoid
           and selected_document.row_tid = document.ctid
          where revision.map_project_id = map_project.id
        )' || case when p_lock then ' for update of map_project' else '' end || ')
        insert into pg_temp.agent_cascade_delete_rows select * from selected on conflict do nothing';
      get diagnostics v_added = row_count;
      if v_added > 0 then v_changed := true; end if;
    end if;
    exit when not v_changed;
  end loop;

  select count(*) into v_total from pg_temp.agent_cascade_delete_rows;
  select jsonb_build_object(
    'fingerprint', pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(pg_catalog.string_agg(
        pg_catalog.encode(extensions.digest(pg_catalog.convert_to(payload::text, 'UTF8'), 'sha256'), 'hex'),
        '' order by relid, payload::text
      ), 'UTF8'), 'sha256'), 'hex'),
    'rowCount', v_total,
    'tableCounts', coalesce((
      select jsonb_object_agg(table_name, row_count)
      from (select relid::pg_catalog.regclass::text table_name, count(*) row_count
        from pg_temp.agent_cascade_delete_rows group by relid) counts
    ), '{}'::jsonb)
  ) into v_payload from pg_temp.agent_cascade_delete_rows;

  drop table pg_temp.agent_cascade_delete_rows;
  return v_payload;
end;
$$;

create function public.agent_prepare_project_cascade_delete(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_project public.projects%rowtype; v_snapshot jsonb;
begin
  if not public.is_project_owner_or_admin(p_project_id, auth.uid()) then
    raise exception 'Only project admins can delete projects' using errcode = '42501';
  end if;
  select * into v_project from public.projects where id = p_project_id;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
  v_snapshot := private.agent_cascade_delete_snapshot(p_project_id);
  return v_snapshot || jsonb_build_object('projectId', p_project_id, 'name', v_project.name,
    'updatedAt', v_project.updated_at);
end;
$$;

create function public.agent_delete_project_cascade_if_current(
  p_project_id uuid, p_user_id uuid, p_expected_fingerprint text
)
returns table (cleanup_job_id uuid, bucket_id text, storage_paths text[])
language plpgsql security definer set search_path = '' as $$
declare v_snapshot jsonb;
begin
  if p_expected_fingerprint is null or p_expected_fingerprint = '' then
    raise exception 'Delete confirmation is required' using errcode = '22023';
  end if;
  perform 1 from public.projects where id = p_project_id for update;
  if not found then raise exception 'Project changed after approval' using errcode = 'PT409'; end if;
  if not public.is_project_owner_or_admin(p_project_id, p_user_id) then
    raise exception 'Only project admins can delete projects' using errcode = '42501';
  end if;
  v_snapshot := private.agent_cascade_delete_snapshot(p_project_id, null, true);
  if v_snapshot->>'fingerprint' is distinct from p_expected_fingerprint then
    raise exception 'Project contents changed after approval' using errcode = 'PT409';
  end if;
  return query select * from public.delete_project_and_enqueue_storage_cleanup(p_project_id);
end;
$$;

create function public.agent_prepare_folder_cascade_delete(p_project_id uuid, p_folder_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_folder public.folders%rowtype; v_snapshot jsonb;
begin
  if not public.is_project_owner_or_admin(p_project_id, auth.uid()) then
    raise exception 'Only project admins can delete folders' using errcode = '42501';
  end if;
  select * into v_folder from public.folders
    where id = p_folder_id and project_id = p_project_id;
  if not found then raise exception 'Folder not found' using errcode = 'P0002'; end if;
  v_snapshot := private.agent_cascade_delete_snapshot(p_project_id, p_folder_id);
  return v_snapshot || jsonb_build_object('projectId', p_project_id, 'folderId', p_folder_id,
    'name', v_folder.name, 'updatedAt', v_folder.updated_at);
end;
$$;

create function public.agent_delete_folder_cascade_if_current(
  p_project_id uuid, p_folder_id uuid, p_expected_fingerprint text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_snapshot jsonb; v_folder_id uuid;
begin
  if p_expected_fingerprint is null or p_expected_fingerprint = '' then
    raise exception 'Delete confirmation is required' using errcode = '22023';
  end if;
  perform 1 from public.folders where id = p_folder_id and project_id = p_project_id for update;
  if not found then raise exception 'Folder changed after approval' using errcode = 'PT409'; end if;
  if not public.is_project_owner_or_admin(p_project_id, auth.uid()) then
    raise exception 'Only project admins can delete folders' using errcode = '42501';
  end if;
  v_snapshot := private.agent_cascade_delete_snapshot(p_project_id, p_folder_id, true);
  if v_snapshot->>'fingerprint' is distinct from p_expected_fingerprint then
    raise exception 'Folder contents changed after approval' using errcode = 'PT409';
  end if;

  for v_folder_id in
    with recursive subtree as (
      select id, 0 depth from public.folders where id = p_folder_id
      union all
      select child.id, parent.depth + 1 from public.folders child
      join subtree parent on child.parent_folder_id = parent.id
    ) select id from subtree order by depth desc
  loop
    delete from public.documents where folder_id = v_folder_id;
    delete from public.libraries where folder_id = v_folder_id;
    delete from public.folders where id = v_folder_id;
  end loop;
  return p_folder_id;
end;
$$;

revoke all on function private.agent_cascade_delete_snapshot(uuid, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.agent_prepare_project_cascade_delete(uuid) from public, anon, service_role;
revoke all on function public.agent_delete_project_cascade_if_current(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.agent_prepare_folder_cascade_delete(uuid, uuid) from public, anon, service_role;
revoke all on function public.agent_delete_folder_cascade_if_current(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.agent_prepare_project_cascade_delete(uuid) to authenticated;
grant execute on function public.agent_delete_project_cascade_if_current(uuid, uuid, text) to service_role;
grant execute on function public.agent_prepare_folder_cascade_delete(uuid, uuid) to authenticated;
grant execute on function public.agent_delete_folder_cascade_if_current(uuid, uuid, text) to authenticated;
