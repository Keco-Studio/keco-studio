-- Account storage accounting for document Markdown bodies.
-- Documents are stored in Postgres rather than Supabase Storage, but their
-- UTF-8 Markdown bytes are still user data and must count toward the quota.

create table public.project_storage_document_content (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references public.documents(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  mime_type text not null default 'text/markdown',
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index project_storage_document_content_project_idx
  on public.project_storage_document_content (project_id, updated_at desc);

alter table public.project_storage_document_content enable row level security;
revoke all on table public.project_storage_document_content from public, anon, authenticated;

-- Keep one accounting row per non-empty document. The child-table trigger below
-- owns quota counter changes, so every documents write path is covered by the
-- database regardless of whether it uses the editor, an RPC, or a service job.
create or replace function private.sync_document_content_storage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_size bigint;
begin
  if tg_op = 'DELETE' then
    delete from public.project_storage_document_content
    where document_id = old.id;
    return old;
  end if;

  select project.owner_id into v_owner_id
  from public.projects project
  where project.id = new.project_id;
  if v_owner_id is null then
    delete from public.project_storage_document_content
    where document_id = new.id;
    return new;
  end if;

  v_size := pg_catalog.octet_length(coalesce(new.content, ''));
  if v_size <= 0 then
    delete from public.project_storage_document_content
    where document_id = new.id;
  else
    insert into public.project_storage_document_content (
      document_id, project_id, owner_id, display_name, mime_type, size_bytes
    ) values (
      new.id, new.project_id, v_owner_id, new.name, 'text/markdown', v_size
    )
    on conflict (document_id) do update set
      project_id = excluded.project_id,
      owner_id = excluded.owner_id,
      display_name = excluded.display_name,
      size_bytes = excluded.size_bytes,
      updated_at = clock_timestamp();
  end if;
  return new;
end;
$$;

create or replace function private.settle_document_content_storage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quota public.account_storage_quotas%rowtype;
  v_delta bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('account-project-storage-accounting', 0)
  );

  if tg_op = 'DELETE' then
    select * into v_quota
    from public.account_storage_quotas quota
    where quota.owner_id = old.owner_id
    for update;
    if not found or v_quota.used_bytes < old.size_bytes then
      raise exception 'Storage usage underflow'
        using errcode = 'P0001', detail = 'STORAGE_USAGE_UNDERFLOW';
    end if;
    update public.account_storage_quotas
    set used_bytes = used_bytes - old.size_bytes, updated_at = clock_timestamp()
    where owner_id = old.owner_id;
    return old;
  end if;

  if tg_op = 'INSERT' then
    insert into public.account_storage_quotas (owner_id)
    values (new.owner_id)
    on conflict (owner_id) do nothing;
    select * into v_quota
    from public.account_storage_quotas quota
    where quota.owner_id = new.owner_id
    for update;
    v_delta := new.size_bytes;
  else
    if old.owner_id = new.owner_id then
      select * into v_quota
      from public.account_storage_quotas quota
      where quota.owner_id = new.owner_id
      for update;
      v_delta := new.size_bytes - old.size_bytes;
    else
      select * into v_quota
      from public.account_storage_quotas quota
      where quota.owner_id = old.owner_id
      for update;
      if not found or v_quota.used_bytes < old.size_bytes then
        raise exception 'Storage usage underflow'
          using errcode = 'P0001', detail = 'STORAGE_USAGE_UNDERFLOW';
      end if;
      update public.account_storage_quotas
      set used_bytes = used_bytes - old.size_bytes, updated_at = clock_timestamp()
      where owner_id = old.owner_id;
      insert into public.account_storage_quotas (owner_id)
      values (new.owner_id)
      on conflict (owner_id) do nothing;
      select * into v_quota
      from public.account_storage_quotas quota
      where quota.owner_id = new.owner_id
      for update;
      v_delta := new.size_bytes;
    end if;
  end if;

  if v_delta < 0 and v_quota.used_bytes < -v_delta then
    raise exception 'Storage usage underflow'
      using errcode = 'P0001', detail = 'STORAGE_USAGE_UNDERFLOW';
  end if;
  if v_delta > 0 and v_delta > v_quota.quota_bytes - v_quota.used_bytes - v_quota.reserved_bytes then
    raise exception 'Project storage quota exceeded'
      using errcode = 'P0001', detail = 'STORAGE_QUOTA_EXCEEDED';
  end if;
  update public.account_storage_quotas
  set used_bytes = used_bytes + v_delta, updated_at = clock_timestamp()
  where owner_id = new.owner_id;
  return new;
end;
$$;

drop trigger if exists trg_sync_document_content_storage on public.documents;
create trigger trg_sync_document_content_storage
after insert or delete or update of project_id, name, content on public.documents
for each row execute function private.sync_document_content_storage();

-- Backfill existing non-empty documents before installing the counter trigger;
-- the rebuild below repairs any
-- pre-existing counter drift and deliberately permits an already-over-quota
-- account to be migrated so future writes can be blocked normally.
insert into public.project_storage_document_content (
  document_id, project_id, owner_id, display_name, mime_type, size_bytes
)
select d.id, d.project_id, project.owner_id, d.name,
  'text/markdown', pg_catalog.octet_length(d.content)
from public.documents d
join public.projects project on project.id = d.project_id
where project.owner_id is not null
  and pg_catalog.octet_length(d.content) > 0
on conflict (document_id) do update set
  project_id = excluded.project_id,
  owner_id = excluded.owner_id,
  display_name = excluded.display_name,
  size_bytes = excluded.size_bytes,
  updated_at = clock_timestamp();

-- Older document-image rows were recorded before source_entity_id was wired
-- through the document editor/import paths. Recover unambiguous references so
-- those images can be folded into their document's single logical file row.
with matches as (
  select file.id as file_id, min(d.id::text)::uuid as document_id
  from public.project_storage_files file
  join public.documents d on d.project_id = file.project_id
    and pg_catalog.strpos(d.content, file.object_path) > 0
  where file.source_kind = 'document_image'
    and file.source_entity_id is null
    and file.project_id is not null
  group by file.id
  having count(*) = 1
)
update public.project_storage_files file
set source_entity_id = matches.document_id, updated_at = clock_timestamp()
from matches
where file.id = matches.file_id;

drop trigger if exists trg_settle_document_content_storage on public.project_storage_document_content;
create trigger trg_settle_document_content_storage
after insert or delete or update of project_id, owner_id, size_bytes
on public.project_storage_document_content
for each row execute function private.settle_document_content_storage();

create or replace function public.account_storage_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_quota public.account_storage_quotas%rowtype;
  v_owned jsonb;
  v_shared jsonb;
  v_unassigned jsonb;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_quota from public.account_storage_quotas quota where quota.owner_id = v_actor;
  if not found then
    v_quota.owner_id := v_actor;
    v_quota.quota_bytes := 1099511627776;
    v_quota.used_bytes := 0;
    v_quota.reserved_bytes := 0;
  end if;

  select coalesce(jsonb_agg(row_json order by row_json ->> 'name'), '[]'::jsonb) into v_owned
  from (
    select jsonb_build_object(
      'id', project.id, 'name', project.name,
      'ownerName', coalesce(profile.full_name, profile.username, ''),
      'fileCount', coalesce((select count(*) from public.project_storage_files file
        where file.project_id = project.id and file.owner_id = v_actor and file.lifecycle_status = 'active'
          and not (file.source_kind = 'document_image' and exists (
            select 1 from public.documents doc
            where doc.id = file.source_entity_id and doc.project_id = project.id
          ))), 0)
        + coalesce((select count(*) from (
          select content.document_id
          from public.project_storage_document_content content
          where content.project_id = project.id
          union
          select file.source_entity_id
          from public.project_storage_files file
          join public.documents doc on doc.id = file.source_entity_id
            and doc.project_id = project.id
          where file.project_id = project.id and file.owner_id = v_actor
            and file.lifecycle_status = 'active' and file.source_kind = 'document_image'
        ) document_files), 0),
      'usedBytes', coalesce((select sum(file.size_bytes) from public.project_storage_files file
        where file.project_id = project.id and file.owner_id = v_actor and file.lifecycle_status = 'active'), 0)
        + coalesce((select sum(content.size_bytes) from public.project_storage_document_content content
        where content.project_id = project.id), 0),
      'ownedByCurrentUser', true
    ) as row_json
    from public.projects project
    left join public.profiles profile on profile.id = project.owner_id
    where project.owner_id = v_actor
  ) owned;

  select coalesce(jsonb_agg(row_json order by row_json ->> 'name'), '[]'::jsonb) into v_shared
  from (
    select jsonb_build_object(
      'id', project.id, 'name', project.name,
      'ownerName', coalesce(profile.full_name, profile.username, ''),
      'fileCount', coalesce((select count(*) from public.project_storage_files file
        where file.project_id = project.id and file.owner_id = project.owner_id and file.lifecycle_status = 'active'
          and not (file.source_kind = 'document_image' and exists (
            select 1 from public.documents doc
            where doc.id = file.source_entity_id and doc.project_id = project.id
          ))), 0)
        + coalesce((select count(*) from (
          select content.document_id
          from public.project_storage_document_content content
          where content.project_id = project.id
          union
          select file.source_entity_id
          from public.project_storage_files file
          join public.documents doc on doc.id = file.source_entity_id
            and doc.project_id = project.id
          where file.project_id = project.id and file.owner_id = project.owner_id
            and file.lifecycle_status = 'active' and file.source_kind = 'document_image'
        ) document_files), 0),
      'usedBytes', coalesce((select sum(file.size_bytes) from public.project_storage_files file
        where file.project_id = project.id and file.owner_id = project.owner_id and file.lifecycle_status = 'active'), 0)
        + coalesce((select sum(content.size_bytes) from public.project_storage_document_content content
        where content.project_id = project.id), 0),
      'ownedByCurrentUser', false
    ) as row_json
    from public.projects project
    join public.project_collaborators collaborator on collaborator.project_id = project.id
      and collaborator.user_id = v_actor and collaborator.accepted_at is not null
    left join public.profiles profile on profile.id = project.owner_id
    where project.owner_id <> v_actor
  ) shared;

  select case when count(file.id) = 0 then null else jsonb_build_object(
    'fileCount', count(file.id), 'usedBytes', coalesce(sum(file.size_bytes), 0)
  ) end into v_unassigned
  from public.project_storage_files file
  where file.owner_id = v_actor and file.project_id is null and file.lifecycle_status = 'active';

  return jsonb_build_object(
    'quotaBytes', v_quota.quota_bytes, 'usedBytes', v_quota.used_bytes,
    'reservedBytes', v_quota.reserved_bytes,
    'remainingBytes', v_quota.quota_bytes - v_quota.used_bytes - v_quota.reserved_bytes,
    'ownedProjects', v_owned, 'sharedProjects', v_shared, 'unassigned', v_unassigned
  );
end;
$$;

create or replace function public.account_storage_project_files(
  p_project_id uuid, p_query text default null, p_sort text default 'size_desc',
  p_limit integer default 50, p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_total bigint;
  v_items jsonb;
begin
  perform public.storage_require_reader(p_project_id, v_actor);
  if p_sort not in ('name_asc', 'name_desc', 'size_asc', 'size_desc', 'created_asc', 'created_desc') then
    p_sort := 'size_desc';
  end if;

  with document_parts as (
    select content.document_id, content.display_name, content.mime_type,
      content.size_bytes, content.created_at
    from public.project_storage_document_content content
    where content.project_id = p_project_id
    union all
    select file.source_entity_id, doc.name, file.mime_type,
      file.size_bytes, file.created_at
    from public.project_storage_files file
    join public.documents doc on doc.id = file.source_entity_id
      and doc.project_id = p_project_id
    where file.project_id = p_project_id and file.lifecycle_status = 'active'
      and file.source_kind = 'document_image'
      and file.source_entity_id is not null
  ), listed as (
    select min(part.document_id::text)::uuid as id, min(part.display_name) as display_name,
      case when count(*) filter (where part.mime_type = 'text/markdown') = count(*)
        then 'text/markdown' else 'application/x-keco-document' end as mime_type,
      sum(part.size_bytes) as size_bytes, 'document_content'::text as source_kind,
      min(part.document_id::text)::uuid as source_entity_id, min(part.created_at) as created_at
    from document_parts part
    group by part.document_id
    having nullif(btrim(p_query), '') is null
      or min(part.display_name) ilike '%' || btrim(p_query) || '%'
    union all
    select file.id, file.display_name, file.mime_type, file.size_bytes, file.source_kind,
      file.source_entity_id, file.created_at
    from public.project_storage_files file
    where file.project_id = p_project_id and file.lifecycle_status = 'active'
      and not (file.source_kind = 'document_image' and exists (
        select 1 from public.documents doc
        where doc.id = file.source_entity_id and doc.project_id = p_project_id
      ))
      and (nullif(btrim(p_query), '') is null or file.display_name ilike '%' || btrim(p_query) || '%')
  )
  select count(*) into v_total from listed;

  with document_parts as (
    select content.document_id, content.display_name, content.mime_type,
      content.size_bytes, content.created_at
    from public.project_storage_document_content content
    where content.project_id = p_project_id
    union all
    select file.source_entity_id, doc.name, file.mime_type,
      file.size_bytes, file.created_at
    from public.project_storage_files file
    join public.documents doc on doc.id = file.source_entity_id
      and doc.project_id = p_project_id
    where file.project_id = p_project_id and file.lifecycle_status = 'active'
      and file.source_kind = 'document_image'
      and file.source_entity_id is not null
  ), listed as (
    select min(part.document_id::text)::uuid as id, min(part.display_name) as display_name,
      case when count(*) filter (where part.mime_type = 'text/markdown') = count(*)
        then 'text/markdown' else 'application/x-keco-document' end as mime_type,
      sum(part.size_bytes) as size_bytes, 'document_content'::text as source_kind,
      min(part.document_id::text)::uuid as source_entity_id, min(part.created_at) as created_at,
      true as source_available
    from document_parts part
    group by part.document_id
    having nullif(btrim(p_query), '') is null
      or min(part.display_name) ilike '%' || btrim(p_query) || '%'
    union all
    select file.id, file.display_name, file.mime_type, file.size_bytes, file.source_kind,
      file.source_entity_id, file.created_at, true
    from public.project_storage_files file
    where file.project_id = p_project_id and file.lifecycle_status = 'active'
      and not (file.source_kind = 'document_image' and exists (
        select 1 from public.documents doc
        where doc.id = file.source_entity_id and doc.project_id = p_project_id
      ))
      and (nullif(btrim(p_query), '') is null or file.display_name ilike '%' || btrim(p_query) || '%')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', listed.id, 'name', listed.display_name, 'mimeType', listed.mime_type,
    'sizeBytes', listed.size_bytes, 'sourceKind', listed.source_kind,
    'sourceEntityId', listed.source_entity_id, 'createdAt', listed.created_at,
    'sourceAvailable', listed.source_available
  )), '[]'::jsonb) into v_items
  from (
    select listed.*
    from listed
    order by
      case when p_sort = 'size_desc' then listed.size_bytes end desc,
      case when p_sort = 'size_asc' then listed.size_bytes end asc,
      case when p_sort = 'created_desc' then listed.created_at end desc,
      case when p_sort = 'created_asc' then listed.created_at end asc,
      case when p_sort = 'name_asc' then lower(listed.display_name) end asc,
      case when p_sort = 'name_desc' then lower(listed.display_name) end desc,
      listed.id
    limit v_limit offset v_offset
  ) listed;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

-- Rebuild includes document content so maintenance repairs remain authoritative.
create or replace function public.service_rebuild_account_storage_quota_totals()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_accounts integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('account-project-storage-accounting', 0)
  );
  insert into public.account_storage_quotas (owner_id, used_bytes, reserved_bytes)
  select owner_id, 0, 0 from (
    select file.owner_id from public.project_storage_files file
    union select content.owner_id from public.project_storage_document_content content
    union select reservation.owner_id from public.storage_upload_reservations reservation
  ) owners on conflict (owner_id) do nothing;

  update public.account_storage_quotas quota
  set used_bytes = coalesce((select sum(file.size_bytes) from public.project_storage_files file
      where file.owner_id = quota.owner_id and file.lifecycle_status in ('active', 'pending_cleanup')), 0)
      + coalesce((select sum(content.size_bytes) from public.project_storage_document_content content
      where content.owner_id = quota.owner_id), 0),
      reserved_bytes = coalesce((select sum(reservation.expected_bytes)
        from public.storage_upload_reservations reservation
        where reservation.owner_id = quota.owner_id and reservation.status = 'pending'
          and reservation.expires_at > clock_timestamp()), 0),
      updated_at = clock_timestamp();
  get diagnostics v_accounts = row_count;
  return jsonb_build_object('rebuiltAccounts', v_accounts);
end;
$$;

revoke all on function private.sync_document_content_storage() from public, anon, authenticated;
revoke all on function private.settle_document_content_storage() from public, anon, authenticated;
revoke all on function public.account_storage_summary() from public, anon, service_role;
revoke all on function public.account_storage_project_files(uuid, text, text, integer, integer) from public, anon, service_role;
revoke all on function public.service_rebuild_account_storage_quota_totals() from public, anon, authenticated;
grant execute on function public.account_storage_summary() to authenticated;
grant execute on function public.account_storage_project_files(uuid, text, text, integer, integer) to authenticated;
grant execute on function public.service_rebuild_account_storage_quota_totals() to service_role;

select public.service_rebuild_account_storage_quota_totals();
