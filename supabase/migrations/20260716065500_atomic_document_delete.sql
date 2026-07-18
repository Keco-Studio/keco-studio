-- Permanently delete a document only when the approved metadata and complete
-- authoritative collaboration state still match under the document row lock.

create or replace function public.delete_document_if_unchanged(
  p_document_id uuid,
  p_project_id uuid,
  p_expected_name text,
  p_expected_folder_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_epoch bigint,
  p_expected_revision bigint,
  p_expected_update_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_tail_ids uuid[];
  v_deleted_id uuid;
  v_user_id uuid := (select auth.uid());
begin
  if p_document_id is null
    or p_project_id is null
    or p_expected_name is null
    or p_expected_updated_at is null
    or p_expected_epoch is null
    or p_expected_revision is null
    or p_expected_epoch < 0
    or p_expected_revision < 0
    or p_expected_update_ids is null then
    raise exception 'Document delete snapshot is invalid'
      using errcode = '22023';
  end if;

  select d.*
    into v_document
    from public.documents d
    where d.id = p_document_id
    for update;

  if not found
    or v_user_id is null
    or v_document.project_id <> p_project_id
    or not (
      public.is_project_owner(v_document.project_id, v_user_id)
      or public.is_editor_or_admin_collaborator(
        v_document.project_id,
        v_user_id
      )
    ) then
    raise exception 'Document not found or not writable'
      using errcode = '42501';
  end if;

  if v_document.name is distinct from p_expected_name
    or v_document.folder_id is distinct from p_expected_folder_id
    or v_document.updated_at is distinct from p_expected_updated_at then
    raise exception 'Document metadata changed'
      using errcode = 'PT409';
  end if;

  if v_document.collab_epoch <> p_expected_epoch
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

  delete from public.documents d
    where d.id = p_document_id
    returning d.id into v_deleted_id;

  if v_deleted_id is null then
    raise exception 'Document not found or not writable'
      using errcode = '42501';
  end if;

  return v_deleted_id;
end;
$$;

revoke all on function public.delete_document_if_unchanged(
  uuid, uuid, text, uuid, timestamptz, bigint, bigint, uuid[]
) from public, anon, service_role;

grant execute on function public.delete_document_if_unchanged(
  uuid, uuid, text, uuid, timestamptz, bigint, bigint, uuid[]
) to authenticated;
