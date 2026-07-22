-- Atomic, bounded MCP document transport reads.

create or replace function public.mcp_read_document_transport_state(
  p_project_id uuid,
  p_document_id uuid
)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  with actor as (
    select auth.uid() as user_id
  ), membership as (
    select p.id
    from public.projects p
    cross join actor a
    where p.id = p_project_id
      and a.user_id is not null
      and (
        p.owner_id = a.user_id
        or exists (
          select 1
          from public.project_collaborators pc
          where pc.project_id = p.id
            and pc.user_id = a.user_id
            and pc.accepted_at is not null
        )
      )
  ), document_head as (
    select d.id, d.name, d.content, d.yjs_state, d.collab_epoch,
      d.collab_revision, d.updated_at
    from public.documents d
    join membership m on m.id = d.project_id
    where d.id = p_document_id
  ), tail_sample as (
    select u.id, u.update_data, u.created_at
    from document_head d
    join public.document_yjs_updates u
      on u.document_id = d.id and u.epoch = d.collab_epoch
    order by u.created_at, u.id
    limit 2001
  ), tail_stats as (
    select count(u.id) as update_count,
      coalesce(sum(pg_catalog.octet_length(u.update_data)), 0) as update_bytes,
      coalesce(sum(pg_catalog.octet_length(jsonb_build_object(
        'id', u.id,
        'update_data', u.update_data,
        'created_at', u.created_at
      )::text)) filter (where u.id is not null), 0) as tail_json_bytes
    from tail_sample u
  )
  select case
    when not exists (select 1 from membership) then
      jsonb_build_object('status', 'access_denied')
    when not exists (select 1 from document_head) then null
    when (select update_count from tail_stats) > 2000
      or (select update_bytes from tail_stats) > 2097152
      or (
        select pg_catalog.octet_length(jsonb_build_object(
            'id', d.id,
            'name', d.name,
            'content', d.content,
            'yjs_state', d.yjs_state,
            'collab_epoch', d.collab_epoch,
            'collab_revision', d.collab_revision,
            'updated_at', d.updated_at
          )::text)
          + s.tail_json_bytes
          + s.update_count * 2
          + 128
        from document_head d cross join tail_stats s
      ) > 15728640 then
      jsonb_build_object('status', 'payload_too_large', 'reason', 'compaction_required')
    else (
      select jsonb_build_object(
        'status', 'ok',
        'head', jsonb_build_object(
          'id', d.id,
          'name', d.name,
          'content', d.content,
          'yjs_state', d.yjs_state,
          'collab_epoch', d.collab_epoch,
          'collab_revision', d.collab_revision,
          'updated_at', d.updated_at
        ),
        'tail', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', u.id,
            'update_data', u.update_data,
            'created_at', u.created_at
          ) order by u.created_at, u.id)
          from tail_sample u
        ), '[]'::jsonb)
      )
      from document_head d
    )
  end
$$;

revoke all on function public.mcp_read_document_transport_state(uuid, uuid)
  from public, anon;
grant execute on function public.mcp_read_document_transport_state(uuid, uuid)
  to authenticated, service_role;
