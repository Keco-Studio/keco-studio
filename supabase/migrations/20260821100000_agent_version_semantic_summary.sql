-- Give Agent edits a user-facing semantic Version History title while keeping
-- the legacy replacement function available to older atomic sync callers.

create or replace function public.replace_document_with_markdown_with_summary(
  p_document_id uuid,
  p_actor_user_id uuid,
  p_backup_version_id uuid,
  p_expected_epoch bigint,
  p_expected_revision bigint,
  p_included_update_ids uuid[],
  p_current_yjs_state text,
  p_current_markdown text,
  p_replacement_yjs_state text,
  p_replacement_markdown text,
  p_change_summary text
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
  v_result record;
  v_summary text := btrim(p_change_summary);
begin
  if v_summary = '' or char_length(v_summary) > 120 then
    raise exception 'Document Agent change summary is invalid'
      using errcode = '22023';
  end if;

  select * into v_result
  from public.replace_document_with_markdown(
    p_document_id,
    p_actor_user_id,
    p_backup_version_id,
    p_expected_epoch,
    p_expected_revision,
    p_included_update_ids,
    p_current_yjs_state,
    p_current_markdown,
    p_replacement_yjs_state,
    p_replacement_markdown
  );

  update public.document_versions
    set name = v_summary
    where id = p_backup_version_id
      and document_id = p_document_id
      and version_type = 'pre_agent';

  return query select
    v_result.collab_epoch,
    v_result.collab_revision,
    v_result.yjs_state,
    v_result.content,
    v_result.updated_at,
    v_result.backup_version_id;
end;
$$;

revoke all on function public.replace_document_with_markdown_with_summary(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.replace_document_with_markdown_with_summary(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text, text
) to service_role;

comment on function public.replace_document_with_markdown_with_summary(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text, text
) is 'Atomically replaces a Document and names its Agent backup with a semantic change summary.';
