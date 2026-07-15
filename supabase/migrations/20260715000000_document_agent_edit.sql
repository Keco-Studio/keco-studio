drop function if exists public.replace_document_with_markdown(
  uuid, uuid, bigint, bigint, uuid[], text, text, text, text
);
drop function if exists public.replace_document_with_markdown(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text
);

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
  if p_backup_version_id is null
    or p_current_yjs_state is null
    or length(p_current_yjs_state) = 0
    or p_replacement_yjs_state is null
    or length(p_replacement_yjs_state) = 0
    or p_replacement_markdown is null then
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

revoke all on function public.replace_document_with_markdown(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text
) from public;
revoke all on function public.replace_document_with_markdown(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text
) from anon, authenticated;
grant execute on function public.replace_document_with_markdown(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text
) to service_role;
