alter table public.documents
  add column if not exists collab_epoch_reason text not null default 'initialize'
  check (collab_epoch_reason in ('initialize', 'normalization', 'restore', 'agent'));

comment on column public.documents.collab_epoch_reason is
  'Durable reason for the current collaboration epoch; clients rebase pending edits only after normalization.';

create or replace function public.normalize_document_collab_state(
  p_document_id uuid,
  p_expected_epoch bigint,
  p_expected_revision bigint,
  p_expected_update_ids uuid[],
  p_yjs_state text,
  p_markdown text
)
returns table (
  collab_epoch bigint,
  collab_revision bigint,
  yjs_state text,
  content text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_tail_ids uuid[];
  v_user_id uuid := (select auth.uid());
begin
  perform public.assert_document_snapshot_payload(
    p_yjs_state,
    p_markdown
  );

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

  if v_document.yjs_state is null
    or v_document.collab_epoch <> p_expected_epoch
    or v_document.collab_revision <> p_expected_revision then
    raise exception 'Document collaboration token changed'
      using errcode = 'PT409';
  end if;

  select coalesce(
      array_agg(u.id order by u.created_at, u.id),
      array[]::uuid[]
    )
    into v_tail_ids
    from public.document_yjs_updates u
    where u.document_id = p_document_id
      and u.epoch = p_expected_epoch;

  if v_tail_ids <> coalesce(p_expected_update_ids, array[]::uuid[]) then
    raise exception 'Document update tail changed'
      using errcode = 'PT409';
  end if;

  update public.documents d
    set yjs_state = p_yjs_state,
        content = p_markdown,
        collab_epoch = v_document.collab_epoch + 1,
        collab_revision = v_document.collab_revision + 1,
        collab_epoch_reason = 'normalization',
        updated_at = now()
    where d.id = p_document_id;

  delete from public.document_yjs_updates
    where document_id = p_document_id
      and epoch = v_document.collab_epoch;

  return query
    select d.collab_epoch, d.collab_revision, d.yjs_state, d.content, d.updated_at
    from public.documents d
    where d.id = p_document_id;
end;
$$;

create or replace function public.restore_document_version(
  p_document_id uuid,
  p_target_version_id uuid,
  p_backup_version_id uuid,
  p_audit_version_id uuid,
  p_expected_epoch bigint,
  p_expected_revision bigint,
  p_included_update_ids uuid[],
  p_current_yjs_state text,
  p_current_markdown text
)
returns table (
  collab_epoch bigint,
  collab_revision bigint,
  yjs_state text,
  content text,
  updated_at timestamptz,
  backup_version_id uuid,
  audit_version_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_target public.document_versions%rowtype;
  v_tail_ids uuid[];
  v_user_id uuid := (select auth.uid());
begin
  perform public.assert_document_snapshot_payload(
    p_current_yjs_state,
    p_current_markdown
  );

  if p_backup_version_id is null
    or p_audit_version_id is null
    or p_backup_version_id = p_audit_version_id
  then
    raise exception 'Document restore input is invalid'
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

  if v_document.yjs_state is null
    or v_document.collab_epoch <> p_expected_epoch
    or v_document.collab_revision <> p_expected_revision then
    raise exception 'Document collaboration token changed'
      using errcode = 'PT409';
  end if;

  select coalesce(
      array_agg(u.id order by u.created_at, u.id),
      array[]::uuid[]
    )
    into v_tail_ids
    from public.document_yjs_updates u
    where u.document_id = p_document_id
      and u.epoch = p_expected_epoch;

  if v_tail_ids <> coalesce(p_included_update_ids, array[]::uuid[]) then
    raise exception 'Document update tail changed'
      using errcode = 'PT409';
  end if;

  select v.*
    into v_target
    from public.document_versions v
    where v.id = p_target_version_id
      and v.document_id = p_document_id
      and v.project_id = v_document.project_id;

  if not found then
    raise exception 'Document version not found'
      using errcode = '42501';
  end if;

  perform public.assert_document_snapshot_payload(
    v_target.snapshot_yjs_state,
    v_target.snapshot_content
  );

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
    p_backup_version_id,
    p_document_id,
    v_document.project_id,
    'Before restore',
    'pre_restore',
    p_current_yjs_state,
    p_current_markdown,
    v_document.collab_epoch,
    v_document.collab_revision,
    v_user_id
  );

  insert into public.document_versions (
    id,
    document_id,
    project_id,
    name,
    version_type,
    source_version_id,
    snapshot_yjs_state,
    snapshot_content,
    snapshot_epoch,
    snapshot_revision,
    created_by
  ) values (
    p_audit_version_id,
    p_document_id,
    v_document.project_id,
    left('Restored: ' || v_target.name, 120),
    'restore',
    p_target_version_id,
    v_target.snapshot_yjs_state,
    v_target.snapshot_content,
    v_document.collab_epoch + 1,
    v_document.collab_revision + 1,
    v_user_id
  );

  update public.documents d
    set yjs_state = v_target.snapshot_yjs_state,
        content = v_target.snapshot_content,
        collab_epoch = v_document.collab_epoch + 1,
        collab_revision = v_document.collab_revision + 1,
        collab_epoch_reason = 'restore',
        updated_at = now()
    where d.id = p_document_id;

  delete from public.document_yjs_updates
    where document_id = p_document_id
      and epoch = v_document.collab_epoch;

  return query
    select
      d.collab_epoch,
      d.collab_revision,
      d.yjs_state,
      d.content,
      d.updated_at,
      p_backup_version_id,
      p_audit_version_id
    from public.documents d
    where d.id = p_document_id;
end;
$$;

create or replace function public.replace_document_with_markdown(
  p_document_id uuid,
  p_actor_user_id uuid,
  p_backup_version_id uuid,
  p_expected_epoch bigint,
  p_expected_revision bigint,
  p_included_update_ids uuid[],
  p_current_yjs_state text,
  p_current_markdown text,
  p_replacement_yjs_state text,
  p_replacement_markdown text
)
returns table (
  collab_epoch bigint,
  collab_revision bigint,
  yjs_state text,
  content text,
  updated_at timestamptz,
  backup_version_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_tail_ids uuid[];
  v_user_id uuid := p_actor_user_id;
begin
  perform public.assert_document_snapshot_payload(
    p_current_yjs_state,
    p_current_markdown
  );
  perform public.assert_document_snapshot_payload(
    p_replacement_yjs_state,
    p_replacement_markdown
  );

  if p_backup_version_id is null
  then
    raise exception 'Document Agent edit input is invalid'
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

  if v_document.yjs_state is null
    or v_document.collab_epoch <> p_expected_epoch
    or v_document.collab_revision <> p_expected_revision then
    raise exception 'Document collaboration token changed'
      using errcode = 'PT409';
  end if;

  select coalesce(
      array_agg(u.id order by u.created_at, u.id),
      array[]::uuid[]
    )
    into v_tail_ids
    from public.document_yjs_updates u
    where u.document_id = p_document_id
      and u.epoch = p_expected_epoch;

  if v_tail_ids <> coalesce(p_included_update_ids, array[]::uuid[]) then
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
    p_backup_version_id,
    p_document_id,
    v_document.project_id,
    'Before Agent edit',
    'pre_agent',
    p_current_yjs_state,
    p_current_markdown,
    v_document.collab_epoch,
    v_document.collab_revision,
    v_user_id
  );

  update public.documents d
    set yjs_state = p_replacement_yjs_state,
        content = p_replacement_markdown,
        collab_epoch = v_document.collab_epoch + 1,
        collab_revision = v_document.collab_revision + 1,
        collab_epoch_reason = 'agent',
        updated_at = now()
    where d.id = p_document_id;

  delete from public.document_yjs_updates
    where document_id = p_document_id
      and epoch = v_document.collab_epoch;

  return query
    select
      d.collab_epoch,
      d.collab_revision,
      d.yjs_state,
      d.content,
      d.updated_at,
      p_backup_version_id
    from public.documents d
    where d.id = p_document_id;
end;
$$;

revoke all on function public.normalize_document_collab_state(
  uuid, bigint, bigint, uuid[], text, text
) from public, anon, authenticated;
grant execute on function public.normalize_document_collab_state(
  uuid, bigint, bigint, uuid[], text, text
) to authenticated;

revoke all on function public.restore_document_version(
  uuid, uuid, uuid, uuid, bigint, bigint, uuid[], text, text
) from public;
grant execute on function public.restore_document_version(
  uuid, uuid, uuid, uuid, bigint, bigint, uuid[], text, text
) to authenticated;

revoke all on function public.replace_document_with_markdown(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text
) from public;
revoke all on function public.replace_document_with_markdown(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text
) from anon, authenticated;
grant execute on function public.replace_document_with_markdown(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text
) to service_role;
