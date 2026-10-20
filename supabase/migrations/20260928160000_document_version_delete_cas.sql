-- Bind assistant version deletion to the approved document contents and target snapshot.

create function public.prepare_document_version_delete(
  p_document_id uuid,
  p_version_id uuid
)
returns table (
  project_id uuid,
  document_name text,
  version_name text,
  version_type text,
  document_epoch bigint,
  document_revision bigint,
  state_fingerprint text,
  version_fingerprint text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_version public.document_versions%rowtype;
  v_updates jsonb;
  v_user_id uuid := (select auth.uid());
begin
  select d.* into v_document from public.documents d where d.id = p_document_id;
  if not found or v_user_id is null or not (
    public.is_project_owner(v_document.project_id, v_user_id)
    or public.is_editor_or_admin_collaborator(v_document.project_id, v_user_id)
  ) then
    raise exception 'Document not found or not writable' using errcode = '42501';
  end if;

  select v.* into v_version from public.document_versions v
    where v.id = p_version_id and v.document_id = p_document_id
      and v.project_id = v_document.project_id;
  if not found then raise exception 'Document version not found' using errcode = 'P0002'; end if;
  if v_version.version_type not in ('manual', 'automatic') then
    raise exception 'Audit document versions cannot be deleted' using errcode = 'PT409';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'data', u.update_data)
    order by u.created_at, u.id), '[]'::jsonb)
    into v_updates from public.document_yjs_updates u
    where u.document_id = p_document_id and u.epoch = v_document.collab_epoch;

  return query select v_document.project_id, v_document.name, v_version.name,
    v_version.version_type, v_document.collab_epoch, v_document.collab_revision,
    encode(extensions.digest(convert_to(jsonb_build_object(
      'projectId', v_document.project_id, 'name', v_document.name,
      'epoch', v_document.collab_epoch, 'revision', v_document.collab_revision,
      'content', v_document.content, 'yjsState', v_document.yjs_state,
      'updates', v_updates
    )::text, 'UTF8'), 'sha256'), 'hex'),
    encode(extensions.digest(convert_to(jsonb_build_object(
      'id', v_version.id, 'name', v_version.name, 'type', v_version.version_type,
      'content', v_version.snapshot_content, 'yjsState', v_version.snapshot_yjs_state,
      'epoch', v_version.snapshot_epoch, 'revision', v_version.snapshot_revision,
      'createdAt', v_version.created_at
    )::text, 'UTF8'), 'sha256'), 'hex');
end;
$$;

create function public.delete_document_version_if_unchanged(
  p_document_id uuid,
  p_version_id uuid,
  p_expected_project_id uuid,
  p_expected_epoch bigint,
  p_expected_revision bigint,
  p_expected_state_fingerprint text,
  p_expected_version_fingerprint text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_version public.document_versions%rowtype;
  v_updates jsonb;
  v_state_fingerprint text;
  v_version_fingerprint text;
  v_deleted_id uuid;
  v_user_id uuid := (select auth.uid());
begin
  if p_document_id is null or p_version_id is null or p_expected_project_id is null
    or p_expected_epoch is null or p_expected_revision is null
    or p_expected_state_fingerprint is null
    or p_expected_version_fingerprint is null
    or p_expected_state_fingerprint !~ '^[a-f0-9]{64}$'
    or p_expected_version_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Document version deletion input is invalid' using errcode = '22023';
  end if;

  select d.* into v_document from public.documents d
    where d.id = p_document_id for update;
  if not found or v_user_id is null or not (
    public.is_project_owner(v_document.project_id, v_user_id)
    or public.is_editor_or_admin_collaborator(v_document.project_id, v_user_id)
  ) then
    raise exception 'Document not found or not writable' using errcode = '42501';
  end if;

  select v.* into v_version from public.document_versions v
    where v.id = p_version_id and v.document_id = p_document_id
      and v.project_id = v_document.project_id for update;
  if not found then raise exception 'Document version not found' using errcode = 'P0002'; end if;
  if v_version.version_type not in ('manual', 'automatic') then
    raise exception 'Audit document versions cannot be deleted' using errcode = 'PT409';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'data', u.update_data)
    order by u.created_at, u.id), '[]'::jsonb)
    into v_updates from public.document_yjs_updates u
    where u.document_id = p_document_id and u.epoch = v_document.collab_epoch;
  v_state_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'projectId', v_document.project_id, 'name', v_document.name,
    'epoch', v_document.collab_epoch, 'revision', v_document.collab_revision,
    'content', v_document.content, 'yjsState', v_document.yjs_state,
    'updates', v_updates
  )::text, 'UTF8'), 'sha256'), 'hex');
  v_version_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'id', v_version.id, 'name', v_version.name, 'type', v_version.version_type,
    'content', v_version.snapshot_content, 'yjsState', v_version.snapshot_yjs_state,
    'epoch', v_version.snapshot_epoch, 'revision', v_version.snapshot_revision,
    'createdAt', v_version.created_at
  )::text, 'UTF8'), 'sha256'), 'hex');
  if v_document.project_id is distinct from p_expected_project_id
    or v_document.collab_epoch is distinct from p_expected_epoch
    or v_document.collab_revision is distinct from p_expected_revision
    or v_state_fingerprint is distinct from p_expected_state_fingerprint
    or v_version_fingerprint is distinct from p_expected_version_fingerprint then
    raise exception 'Document or version changed after approval' using errcode = 'PT409';
  end if;

  begin
    delete from public.document_versions v
      where v.id = p_version_id and v.document_id = p_document_id
      returning v.id into v_deleted_id;
  exception when foreign_key_violation then
    raise exception 'Document version is referenced by an audit record' using errcode = 'PT409';
  end;
  return v_deleted_id;
end;
$$;

revoke all on function public.prepare_document_version_delete(uuid, uuid)
  from public, anon, service_role;
revoke all on function public.delete_document_version_if_unchanged(uuid, uuid, uuid, bigint, bigint, text, text)
  from public, anon, service_role;
grant execute on function public.prepare_document_version_delete(uuid, uuid) to authenticated;
grant execute on function public.delete_document_version_if_unchanged(uuid, uuid, uuid, bigint, bigint, text, text) to authenticated;
