drop function if exists public.create_imported_document(
  uuid, uuid, uuid, uuid, uuid, text, text, text
);

create function public.create_imported_document(
  p_document_id uuid,
  p_version_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid,
  p_folder_id uuid,
  p_name text,
  p_description text,
  p_markdown text,
  p_yjs_state text
)
returns table (
  id uuid,
  project_id uuid,
  folder_id uuid,
  name text,
  description text,
  content text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_existing_version public.document_versions%rowtype;
  v_user_id uuid := p_actor_user_id;
  v_description text := coalesce(btrim(p_description), '');
begin
  perform public.assert_document_snapshot_payload(p_yjs_state, p_markdown);

  if p_document_id is null
    or p_version_id is null
    or p_project_id is null
    or p_name is null
    or p_name <> btrim(p_name)
    or char_length(p_name) not between 1 and 255
    or char_length(v_description) > 250
  then
    raise exception 'Imported document input is invalid'
      using errcode = '22023';
  end if;

  if v_user_id is null or not (
    public.is_project_owner(p_project_id, v_user_id)
    or public.is_editor_or_admin_collaborator(p_project_id, v_user_id)
  ) then
    raise exception 'Project not found or not writable'
      using errcode = '42501';
  end if;

  if p_folder_id is not null and not exists (
    select 1
      from public.folders f
      where f.id = p_folder_id
        and f.project_id = p_project_id
  ) then
    raise exception 'Folder not found in project'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'document-import-document:' || p_document_id::text,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'document-import-version:' || p_version_id::text,
      0
    )
  );

  select d.*
    into v_document
    from public.documents d
    where d.id = p_document_id;

  if found then
    if v_document.project_id <> p_project_id
      or v_document.folder_id is distinct from p_folder_id
      or v_document.name <> p_name
      or v_document.description <> v_description
      or v_document.content <> p_markdown
      or v_document.collab_epoch <> 0
      or v_document.collab_revision <> 1
      or v_document.created_by is distinct from v_user_id then
      raise exception 'Imported document id was reused'
        using errcode = '22023';
    end if;

    select v.*
      into v_existing_version
      from public.document_versions v
      where v.id = p_version_id;

    if not found
      or v_existing_version.document_id <> v_document.id
      or v_existing_version.project_id <> v_document.project_id
      or v_existing_version.name <> 'Initial import'
      or v_existing_version.version_type <> 'import'
      or v_existing_version.snapshot_yjs_state is distinct from v_document.yjs_state
      or v_existing_version.snapshot_content is distinct from v_document.content
      or v_existing_version.snapshot_epoch <> v_document.collab_epoch
      or v_existing_version.snapshot_revision <> v_document.collab_revision
      or v_existing_version.created_by is distinct from v_user_id then
      raise exception 'Imported document version id was reused'
        using errcode = '22023';
    end if;

    return query
      select
        v_document.id,
        v_document.project_id,
        v_document.folder_id,
        v_document.name,
        v_document.description,
        v_document.content,
        v_document.created_by,
        v_document.created_at,
        v_document.updated_at;
    return;
  end if;

  if exists (
    select 1
      from public.document_versions v
      where v.id = p_version_id
  ) then
    raise exception 'Imported document version id was reused'
      using errcode = '22023';
  end if;

  insert into public.documents (
    id,
    project_id,
    folder_id,
    name,
    description,
    content,
    yjs_state,
    collab_epoch,
    collab_revision,
    created_by
  ) values (
    p_document_id,
    p_project_id,
    p_folder_id,
    p_name,
    v_description,
    p_markdown,
    p_yjs_state,
    0,
    1,
    v_user_id
  )
  returning * into v_document;

  insert into public.document_versions (
    id,
    document_id,
    project_id,
    name,
    version_type,
    snapshot_yjs_state,
    snapshot_content,
    snapshot_epoch,
    snapshot_revision,
    created_by
  ) values (
    p_version_id,
    v_document.id,
    v_document.project_id,
    'Initial import',
    'import',
    v_document.yjs_state,
    v_document.content,
    v_document.collab_epoch,
    v_document.collab_revision,
    v_user_id
  );

  return query
    select
      v_document.id,
      v_document.project_id,
      v_document.folder_id,
      v_document.name,
      v_document.description,
      v_document.content,
      v_document.created_by,
      v_document.created_at,
      v_document.updated_at;
end;
$$;

revoke all on function public.create_imported_document(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.create_imported_document(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text
) to service_role;
