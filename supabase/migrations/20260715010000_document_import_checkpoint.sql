drop function if exists public.create_imported_document(
  uuid, uuid, uuid, uuid, text, text, text
);
drop function if exists public.create_imported_document(
  uuid, uuid, uuid, uuid, uuid, text, text, text
);

create or replace function public.create_imported_document(
  p_document_id uuid,
  p_version_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid,
  p_folder_id uuid,
  p_name text,
  p_markdown text,
  p_yjs_state text
)
returns table (
  id uuid,
  project_id uuid,
  folder_id uuid,
  name text,
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
begin
  if p_document_id is null
    or p_version_id is null
    or p_project_id is null
    or p_name is null
    or p_name <> btrim(p_name)
    or char_length(p_name) not between 1 and 255
    or p_markdown is null
    or p_yjs_state is null
    or length(p_yjs_state) = 0 then
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
      v_document.content,
      v_document.created_by,
      v_document.created_at,
      v_document.updated_at;
end;
$$;

revoke all on function public.create_imported_document(
  uuid, uuid, uuid, uuid, uuid, text, text, text
) from public;
revoke all on function public.create_imported_document(
  uuid, uuid, uuid, uuid, uuid, text, text, text
) from anon, authenticated;

grant execute on function public.create_imported_document(
  uuid, uuid, uuid, uuid, uuid, text, text, text
) to service_role;

create or replace function public.create_document_import_checkpoint(
  p_version_id uuid,
  p_document_id uuid,
  p_expected_epoch bigint,
  p_expected_revision bigint,
  p_name text
)
returns table (
  version_id uuid,
  document_id uuid,
  project_id uuid,
  name text,
  version_type text,
  source_version_id uuid,
  snapshot_epoch bigint,
  snapshot_revision bigint,
  created_by uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_existing public.document_versions%rowtype;
  v_created public.document_versions%rowtype;
  v_user_id uuid := (select auth.uid());
begin
  if p_version_id is null
    or p_name is null
    or p_name <> btrim(p_name)
    or char_length(p_name) not between 1 and 120
    or p_expected_epoch is null
    or p_expected_revision is null
    or p_expected_epoch < 0
    or p_expected_revision < 0 then
    raise exception 'Document import checkpoint input is invalid'
      using errcode = '22023';
  end if;

  select d.*
    into v_document
    from public.documents d
    where d.id = p_document_id
    for update;

  if not found or v_user_id is null or not (
    public.is_project_owner(v_document.project_id, v_user_id)
    or public.is_editor_or_admin_collaborator(
      v_document.project_id,
      v_user_id
    )
  ) then
    raise exception 'Document not found or not writable'
      using errcode = '42501';
  end if;

  select v.*
    into v_existing
    from public.document_versions v
    where v.id = p_version_id;

  if found then
    if v_existing.document_id <> p_document_id
      or v_existing.project_id <> v_document.project_id
      or v_existing.name <> p_name
      or v_existing.version_type <> 'import'
      or v_existing.snapshot_epoch <> p_expected_epoch
      or v_existing.snapshot_revision <> p_expected_revision
      or v_existing.created_by is distinct from v_user_id then
      raise exception 'Document import checkpoint id was reused'
        using errcode = '22023';
    end if;

    return query
      select
        v_existing.id,
        v_existing.document_id,
        v_existing.project_id,
        v_existing.name,
        v_existing.version_type,
        v_existing.source_version_id,
        v_existing.snapshot_epoch,
        v_existing.snapshot_revision,
        v_existing.created_by,
        v_existing.created_at;
    return;
  end if;

  if v_document.yjs_state is null
    or v_document.collab_epoch <> p_expected_epoch
    or v_document.collab_revision <> p_expected_revision then
    raise exception 'Document collaboration token changed'
      using errcode = 'PT409';
  end if;

  if exists (
    select 1
      from public.document_yjs_updates u
      where u.document_id = p_document_id
        and u.epoch = p_expected_epoch
  ) then
    raise exception 'Document update tail changed'
      using errcode = 'PT409';
  end if;

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
    p_document_id,
    v_document.project_id,
    p_name,
    'import',
    v_document.yjs_state,
    v_document.content,
    p_expected_epoch,
    p_expected_revision,
    v_user_id
  )
  returning * into v_created;

  return query
    select
      v_created.id,
      v_created.document_id,
      v_created.project_id,
      v_created.name,
      v_created.version_type,
      v_created.source_version_id,
      v_created.snapshot_epoch,
      v_created.snapshot_revision,
      v_created.created_by,
      v_created.created_at;
end;
$$;

revoke all on function public.create_document_import_checkpoint(
  uuid, uuid, bigint, bigint, text
) from public;
revoke all on function public.create_document_import_checkpoint(
  uuid, uuid, bigint, bigint, text
) from anon, service_role;

grant execute on function public.create_document_import_checkpoint(
  uuid, uuid, bigint, bigint, text
) to authenticated;
