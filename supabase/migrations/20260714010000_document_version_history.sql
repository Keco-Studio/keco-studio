-- Immutable document snapshots and atomic state restoration.

alter table public.documents
  add constraint documents_id_project_id_key unique (id, project_id);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  project_id uuid not null,
  name text not null,
  version_type text not null,
  source_version_id uuid references public.document_versions (id),
  snapshot_yjs_state text not null,
  snapshot_content text not null,
  snapshot_epoch bigint not null,
  snapshot_revision bigint not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (document_id, project_id)
    references public.documents (id, project_id) on delete cascade,
  check (name = btrim(name) and char_length(name) between 1 and 120),
  check (
    version_type in (
      'manual', 'automatic', 'pre_restore', 'restore', 'pre_agent', 'import'
    )
  ),
  check (
    (version_type = 'restore' and source_version_id is not null)
    or (version_type <> 'restore' and source_version_id is null)
  ),
  check (length(snapshot_yjs_state) > 0),
  check (snapshot_epoch >= 0),
  check (snapshot_revision >= 0)
);

create index document_versions_document_created_idx
  on public.document_versions (document_id, created_at desc, id desc);

alter table public.document_versions enable row level security;

create policy "document_versions_select_policy"
  on public.document_versions for select
  to authenticated
  using (
    exists (
      select 1
      from public.documents d
      where d.id = document_versions.document_id
        and d.project_id = document_versions.project_id
        and (
          public.is_project_owner(d.project_id, (select auth.uid()))
          or public.is_accepted_collaborator(
            d.project_id,
            (select auth.uid())
          )
        )
    )
  );

grant select on table public.document_versions to authenticated;
revoke insert, update, delete on table public.document_versions
  from anon, authenticated;

create or replace function public.create_document_version(
  p_version_id uuid,
  p_document_id uuid,
  p_expected_epoch bigint,
  p_expected_revision bigint,
  p_included_update_ids uuid[],
  p_name text,
  p_yjs_state text,
  p_markdown text
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
  v_tail_ids uuid[];
  v_user_id uuid := (select auth.uid());
begin
  if p_version_id is null
    or p_yjs_state is null
    or length(p_yjs_state) = 0
    or p_name is null
    or p_name <> btrim(p_name)
    or char_length(p_name) not between 1 and 120 then
    raise exception 'Document version input is invalid'
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
      or v_existing.version_type <> 'manual'
      or v_existing.snapshot_yjs_state <> p_yjs_state
      or v_existing.snapshot_content <> p_markdown
      or v_existing.snapshot_epoch <> p_expected_epoch
      or v_existing.snapshot_revision <> p_expected_revision
      or v_existing.created_by is distinct from v_user_id then
      raise exception 'Document version id was reused'
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
    p_version_id,
    p_document_id,
    v_document.project_id,
    p_name,
    'manual',
    p_yjs_state,
    p_markdown,
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
    or public.is_editor_or_admin_collaborator(
      v_document.project_id,
      v_user_id
    )
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

  if p_markdown is distinct from v_document.content
    and not exists (
      select 1
      from public.document_versions v
      where v.document_id = p_document_id
        and v.version_type = 'automatic'
        and v.created_at > now() - interval '10 minutes'
    ) then
    insert into public.document_versions (
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
      p_document_id,
      v_document.project_id,
      'Automatic checkpoint',
      'automatic',
      p_yjs_state,
      p_markdown,
      p_expected_epoch,
      p_expected_revision + 1,
      v_user_id
    );
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
      and id = any(coalesce(p_included_update_ids, array[]::uuid[]));

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
  if p_backup_version_id is null
    or p_audit_version_id is null
    or p_backup_version_id = p_audit_version_id
    or p_current_yjs_state is null
    or length(p_current_yjs_state) = 0 then
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

revoke all on function public.create_document_version(
  uuid, uuid, bigint, bigint, uuid[], text, text, text
) from public;
revoke all on function public.restore_document_version(
  uuid, uuid, uuid, uuid, bigint, bigint, uuid[], text, text
) from public;
grant execute on function public.create_document_version(
  uuid, uuid, bigint, bigint, uuid[], text, text, text
) to authenticated;
grant execute on function public.restore_document_version(
  uuid, uuid, uuid, uuid, bigint, bigint, uuid[], text, text
) to authenticated;
