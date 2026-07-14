-- Durable Yjs collaboration for project documents.
-- Realtime Broadcast is only the low-latency transport. The compacted snapshot
-- plus the immutable update tail is the authoritative document state.

alter table public.documents
  add column if not exists yjs_state text,
  add column if not exists collab_epoch bigint not null default 0,
  add column if not exists collab_revision bigint not null default 0;

comment on column public.documents.collab_epoch is
  'Yjs state lineage. Destructive replacement increments the epoch.';
comment on column public.documents.collab_revision is
  'CAS revision for initialization, compaction, and state replacement.';

create table public.document_yjs_updates (
  id uuid primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  epoch bigint not null,
  update_data text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (length(update_data) > 0)
);

create index document_yjs_updates_document_epoch_created_idx
  on public.document_yjs_updates (document_id, epoch, created_at, id);

alter table public.document_yjs_updates enable row level security;

create policy "document_yjs_updates_select_policy"
  on public.document_yjs_updates for select
  to authenticated
  using (
    exists (
      select 1
      from public.documents d
      where d.id = document_yjs_updates.document_id
        and (
          public.is_project_owner(d.project_id, (select auth.uid()))
          or public.is_accepted_collaborator(d.project_id, (select auth.uid()))
        )
    )
  );

create policy "document_yjs_updates_insert_policy"
  on public.document_yjs_updates for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.documents d
      where d.id = document_yjs_updates.document_id
        and d.collab_epoch = document_yjs_updates.epoch
        and (
          public.is_project_owner(d.project_id, (select auth.uid()))
          or public.is_editor_or_admin_collaborator(
            d.project_id,
            (select auth.uid())
          )
        )
    )
  );

grant select, insert on table public.document_yjs_updates to authenticated;
revoke update, delete on table public.document_yjs_updates from anon, authenticated;

create or replace function public.initialize_document_collab_state(
  p_document_id uuid,
  p_expected_epoch bigint,
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
  v_user_id uuid := (select auth.uid());
begin
  if p_yjs_state is null or length(p_yjs_state) = 0 then
    raise exception 'Document collaboration state cannot be empty'
      using errcode = '22023';
  end if;

  select d.*
    into v_document
    from public.documents d
    where d.id = p_document_id
    for update;

  if not found or v_user_id is null or not (
    public.is_project_owner(v_document.project_id, v_user_id)
    or public.is_editor_or_admin_collaborator(v_document.project_id, v_user_id)
  ) then
    raise exception 'Document not found or not writable'
      using errcode = '42501';
  end if;

  if v_document.collab_epoch <> p_expected_epoch
    or v_document.collab_revision <> 0
    or v_document.yjs_state is not null then
    raise exception 'Document collaboration state changed'
      using errcode = 'PT409';
  end if;

  update public.documents d
    set yjs_state = p_yjs_state,
        content = p_markdown,
        collab_revision = d.collab_revision + 1,
        updated_at = now()
    where d.id = p_document_id;

  return query
    select d.collab_epoch, d.collab_revision, d.yjs_state, d.content, d.updated_at
    from public.documents d
    where d.id = p_document_id;
end;
$$;

create or replace function public.compact_document_collab_state(
  p_document_id uuid,
  p_expected_epoch bigint,
  p_expected_revision bigint,
  p_included_update_ids uuid[],
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
  v_user_id uuid := (select auth.uid());
begin
  if p_yjs_state is null or length(p_yjs_state) = 0 then
    raise exception 'Compacted collaboration state cannot be empty'
      using errcode = '22023';
  end if;

  select d.*
    into v_document
    from public.documents d
    where d.id = p_document_id
    for update;

  if not found or v_user_id is null or not (
    public.is_project_owner(v_document.project_id, v_user_id)
    or public.is_editor_or_admin_collaborator(v_document.project_id, v_user_id)
  ) then
    raise exception 'Document not found or not writable'
      using errcode = '42501';
  end if;

  if v_document.collab_epoch <> p_expected_epoch
    or v_document.collab_revision <> p_expected_revision then
    raise exception 'Document collaboration token changed'
      using errcode = 'PT409';
  end if;

  if exists (
    select requested.id
    from unnest(coalesce(p_included_update_ids, array[]::uuid[])) as requested(id)
    where not exists (
      select 1
      from public.document_yjs_updates u
      where u.id = requested.id
        and u.document_id = p_document_id
        and u.epoch = p_expected_epoch
    )
  ) then
    raise exception 'Compaction update set changed'
      using errcode = 'PT409';
  end if;

  update public.documents d
    set yjs_state = p_yjs_state,
        content = p_markdown,
        collab_revision = d.collab_revision + 1,
        updated_at = now()
    where d.id = p_document_id;

  delete from public.document_yjs_updates
    where document_id = p_document_id
      and epoch = p_expected_epoch
      and id = any(p_included_update_ids);

  return query
    select d.collab_epoch, d.collab_revision, d.yjs_state, d.content, d.updated_at
    from public.documents d
    where d.id = p_document_id;
end;
$$;

revoke all on function public.initialize_document_collab_state(uuid, bigint, text, text)
  from public;
revoke all on function public.compact_document_collab_state(uuid, bigint, bigint, uuid[], text, text)
  from public;
grant execute on function public.initialize_document_collab_state(uuid, bigint, text, text)
  to authenticated;
grant execute on function public.compact_document_collab_state(uuid, bigint, bigint, uuid[], text, text)
  to authenticated;

-- Body/state columns are mutated only by the guarded functions above. Document
-- name and same-project folder movement retain their existing direct path.
revoke update on table public.documents from anon;
revoke update on table public.documents from authenticated;
grant update (name, folder_id) on table public.documents to authenticated;

create or replace function public.document_id_from_collab_topic(p_topic text)
returns uuid
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
begin
  if p_topic !~ '^doc-collab:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  return substring(p_topic from 12)::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.project_id_from_sidebar_topic(p_topic text)
returns uuid
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  if p_topic !~ '^folders:project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  return substring(p_topic from 17)::uuid;
exception when others then
  return null;
end;
$$;

revoke all on function public.document_id_from_collab_topic(text) from public;
revoke all on function public.project_id_from_sidebar_topic(text) from public;
grant execute on function public.document_id_from_collab_topic(text) to authenticated;
grant execute on function public.project_id_from_sidebar_topic(text) to authenticated;

drop policy if exists "document_collab_messages_select_policy" on realtime.messages;
create policy "document_collab_messages_select_policy"
  on realtime.messages for select
  to authenticated
  using (
    extension in ('broadcast', 'presence')
    and (
      exists (
        select 1
        from public.documents d
        where d.id = public.document_id_from_collab_topic((select realtime.topic()))
          and (
            public.is_project_owner(d.project_id, (select auth.uid()))
            or public.is_accepted_collaborator(d.project_id, (select auth.uid()))
          )
      )
      or exists (
        select 1
        from public.projects p
        where p.id = public.project_id_from_sidebar_topic((select realtime.topic()))
          and (
            public.is_project_owner(p.id, (select auth.uid()))
            or public.is_accepted_collaborator(p.id, (select auth.uid()))
          )
      )
    )
  );

drop policy if exists "document_collab_messages_insert_policy" on realtime.messages;
create policy "document_collab_messages_insert_policy"
  on realtime.messages for insert
  to authenticated
  with check (
    extension in ('broadcast', 'presence')
    and (
      exists (
        select 1
        from public.documents d
        where d.id = public.document_id_from_collab_topic((select realtime.topic()))
          and (
            public.is_project_owner(d.project_id, (select auth.uid()))
            or public.is_editor_or_admin_collaborator(
              d.project_id,
              (select auth.uid())
            )
          )
      )
      or exists (
        select 1
        from public.projects p
        where p.id = public.project_id_from_sidebar_topic((select realtime.topic()))
          and (
            public.is_project_owner(p.id, (select auth.uid()))
            or public.is_editor_or_admin_collaborator(p.id, (select auth.uid()))
          )
      )
    )
  );

-- Neither documents nor document_yjs_updates is added to supabase_realtime.
-- Clients use private Broadcast channels and explicitly read the durable tail.
