-- Account-owned storage accounting. Raw accounting rows are private; callers
-- use the SECURITY DEFINER RPCs below so quota changes are serialized.

create table public.account_storage_quotas (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  quota_bytes bigint not null default 1099511627776 check (quota_bytes > 0),
  used_bytes bigint not null default 0 check (used_bytes >= 0),
  reserved_bytes bigint not null default 0 check (reserved_bytes >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (used_bytes <= 9223372036854775807 - reserved_bytes)
);

create table public.project_storage_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  bucket_id text not null check (bucket_id in ('library-media-files','project-assets','map-assets','character-assets','tiptap-images')),
  object_path text not null check (object_path = btrim(object_path) and object_path <> '' and object_path not like '%..%'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 255),
  mime_type text not null check (char_length(btrim(mime_type)) between 1 and 200),
  size_bytes bigint not null check (size_bytes > 0),
  source_kind text not null check (source_kind in ('project_asset','library_media','document_image','map_reference','map_asset','character_asset','legacy_unassigned')),
  source_entity_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  object_created_at timestamptz,
  lifecycle_status text not null default 'active' check (lifecycle_status in ('active','pending_cleanup')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (bucket_id, object_path),
  check ((source_kind = 'legacy_unassigned') = (project_id is null))
);

create table public.project_storage_file_locations (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.project_storage_files(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null check (source_kind in ('project_asset','library_media','document_image','map_reference','map_asset','character_asset')),
  source_entity_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (file_id, project_id, source_kind, source_entity_id)
);

create table public.storage_upload_reservations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  bucket_id text not null,
  object_path text not null,
  display_name text not null,
  mime_type text not null,
  source_kind text not null,
  source_entity_id uuid,
  expected_bytes bigint not null check (expected_bytes > 0),
  actual_bytes bigint check (actual_bytes is null or actual_bytes > 0),
  status text not null default 'pending' check (status in ('pending','finalized','released','expired')),
  file_id uuid references public.project_storage_files(id) on delete set null,
  expires_at timestamptz not null default (clock_timestamp() + interval '2 hours'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (bucket_id, object_path)
);

create index project_storage_files_owner_project_idx
  on public.project_storage_files (owner_id, project_id, created_at desc);
create index storage_upload_reservations_owner_status_idx
  on public.storage_upload_reservations (owner_id, status, expires_at);

alter table public.account_storage_quotas enable row level security;
alter table public.project_storage_files enable row level security;
alter table public.project_storage_file_locations enable row level security;
alter table public.storage_upload_reservations enable row level security;

revoke all on table public.account_storage_quotas from public, anon, authenticated;
revoke all on table public.project_storage_files from public, anon, authenticated;
revoke all on table public.project_storage_file_locations from public, anon, authenticated;
revoke all on table public.storage_upload_reservations from public, anon, authenticated;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create function private.storage_has_pending_upload_reservation(p_bucket_id text, p_object_path text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.storage_upload_reservations reservation
    join public.projects project on project.id = reservation.project_id
    where reservation.requested_by = auth.uid()
      and reservation.bucket_id = p_bucket_id
      and reservation.object_path = p_object_path
      and reservation.status = 'pending'
      and reservation.expires_at > clock_timestamp()
      and (project.owner_id = auth.uid() or exists (
        select 1 from public.project_collaborators collaborator
        where collaborator.project_id = project.id and collaborator.user_id = auth.uid()
          and collaborator.accepted_at is not null and collaborator.role in ('admin', 'editor')
      ))
  );
$$;

-- SECURITY DEFINER helper deliberately has no authenticated grant. It returns
-- the billing owner only after accepting owners and accepted admin/editors.
create function public.storage_require_writer(p_project_id uuid, p_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
begin
  select project.owner_id into v_owner_id
  from public.projects project
  where project.id = p_project_id;

  if p_actor_id is null or v_owner_id is null or not (
    v_owner_id = p_actor_id
    or exists (
      select 1
      from public.project_collaborators collaborator
      where collaborator.project_id = p_project_id
        and collaborator.user_id = p_actor_id
        and collaborator.accepted_at is not null
        and collaborator.role in ('admin', 'editor')
    )
  ) then
    raise exception 'Project storage write forbidden'
      using errcode = 'P0001', detail = 'STORAGE_PROJECT_FORBIDDEN';
  end if;

  return v_owner_id;
end;
$$;

create function public.storage_require_reader(p_project_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null or not exists (
    select 1 from public.projects project
    where project.id = p_project_id
      and (
        project.owner_id = p_actor_id
        or exists (
          select 1 from public.project_collaborators collaborator
          where collaborator.project_id = project.id
            and collaborator.user_id = p_actor_id
            and collaborator.accepted_at is not null
        )
      )
  ) then
    raise exception 'Project storage read forbidden'
      using errcode = 'P0001', detail = 'STORAGE_PROJECT_FORBIDDEN';
  end if;
end;
$$;

create function public.storage_reserve_project_storage_upload(
  p_actor_user_id uuid,
  p_project_id uuid,
  p_bucket_id text,
  p_object_path text,
  p_expected_bytes bigint,
  p_display_name text,
  p_mime_type text,
  p_source_kind text,
  p_source_entity_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_quota public.account_storage_quotas%rowtype;
  v_reservation public.storage_upload_reservations%rowtype;
  v_expired_reservation_id uuid;
begin
  v_owner_id := public.storage_require_writer(p_project_id, p_actor_user_id);

  if p_expected_bytes is null or p_expected_bytes <= 0
     or p_bucket_id not in ('library-media-files','project-assets','map-assets','character-assets','tiptap-images')
     or p_object_path is null or p_object_path <> btrim(p_object_path) or p_object_path = '' or p_object_path like '%..%'
     or p_object_path not like p_actor_user_id::text || '/' || p_project_id::text || '/%'
     or char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 255
     or char_length(btrim(coalesce(p_mime_type, ''))) not between 1 and 200
     or p_source_kind not in ('project_asset','library_media','document_image','map_reference','map_asset','character_asset') then
    raise exception 'Storage object metadata does not match the reservation'
      using errcode = 'P0001', detail = 'STORAGE_OBJECT_MISMATCH';
  end if;

  insert into public.account_storage_quotas (owner_id)
  values (v_owner_id)
  on conflict (owner_id) do nothing;

  select * into v_quota
  from public.account_storage_quotas quota
  where quota.owner_id = v_owner_id
  for update;

  select * into v_reservation
  from public.storage_upload_reservations reservation
  where reservation.bucket_id = p_bucket_id
    and reservation.object_path = p_object_path
  for update;

  if found and v_reservation.status = 'pending' and v_reservation.expires_at <= clock_timestamp() then
    update public.account_storage_quotas
    set reserved_bytes = reserved_bytes - v_reservation.expected_bytes,
        updated_at = clock_timestamp()
    where owner_id = v_owner_id;
    update public.storage_upload_reservations
    set status = 'expired', updated_at = clock_timestamp()
    where id = v_reservation.id;
    v_expired_reservation_id := v_reservation.id;
    v_reservation.id := null;
  end if;

  if v_reservation.id is not null then
    if v_reservation.status = 'pending'
       and v_reservation.owner_id = v_owner_id
       and v_reservation.project_id = p_project_id
       and v_reservation.requested_by = p_actor_user_id
       and v_reservation.expected_bytes = p_expected_bytes
       and v_reservation.display_name = p_display_name
       and v_reservation.mime_type = p_mime_type
       and v_reservation.source_kind = p_source_kind
       and v_reservation.source_entity_id is not distinct from p_source_entity_id then
      return jsonb_build_object(
        'reservationId', v_reservation.id, 'ownerId', v_owner_id,
        'projectId', p_project_id, 'expectedBytes', v_reservation.expected_bytes,
        'reused', true
      );
    end if;
    raise exception 'Storage object metadata does not match the reservation'
      using errcode = 'P0001', detail = 'STORAGE_OBJECT_MISMATCH';
  end if;

  -- Quota predicate: used_bytes + reserved_bytes + p_expected_bytes > quota_bytes.
  if p_expected_bytes > v_quota.quota_bytes - v_quota.used_bytes - v_quota.reserved_bytes then
    raise exception 'Project storage quota exceeded'
      using errcode = 'P0001', detail = 'STORAGE_QUOTA_EXCEEDED';
  end if;

  if v_expired_reservation_id is not null then
    update public.storage_upload_reservations
    set owner_id = v_owner_id, project_id = p_project_id, requested_by = p_actor_user_id,
        display_name = p_display_name, mime_type = p_mime_type, source_kind = p_source_kind,
        source_entity_id = p_source_entity_id, expected_bytes = p_expected_bytes,
        actual_bytes = null, status = 'pending', file_id = null,
        expires_at = clock_timestamp() + interval '2 hours', updated_at = clock_timestamp()
    where id = v_expired_reservation_id
    returning * into v_reservation;
    update public.account_storage_quotas
    set reserved_bytes = reserved_bytes + p_expected_bytes,
        updated_at = clock_timestamp()
    where owner_id = v_owner_id;
    return jsonb_build_object(
      'reservationId', v_reservation.id, 'ownerId', v_owner_id,
      'projectId', p_project_id, 'expectedBytes', p_expected_bytes, 'reused', false
    );
  end if;

  insert into public.storage_upload_reservations (
    owner_id, project_id, requested_by, bucket_id, object_path, display_name,
    mime_type, source_kind, source_entity_id, expected_bytes
  ) values (
    v_owner_id, p_project_id, p_actor_user_id, p_bucket_id, p_object_path, p_display_name,
    p_mime_type, p_source_kind, p_source_entity_id, p_expected_bytes
  ) returning * into v_reservation;

  update public.account_storage_quotas
  set reserved_bytes = reserved_bytes + p_expected_bytes,
      updated_at = clock_timestamp()
  where owner_id = v_owner_id;

  return jsonb_build_object(
    'reservationId', v_reservation.id, 'ownerId', v_owner_id,
    'projectId', p_project_id, 'expectedBytes', p_expected_bytes, 'reused', false
  );
end;
$$;

create function public.storage_finalize_project_storage_upload(
  p_actor_user_id uuid,
  p_reservation_id uuid,
  p_actual_bytes bigint,
  p_source_entity_id uuid default null,
  p_object_created_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.storage_upload_reservations%rowtype;
  v_quota public.account_storage_quotas%rowtype;
  v_file public.project_storage_files%rowtype;
  v_storage_size text;
  v_verified_bytes bigint;
begin
  select * into v_reservation
  from public.storage_upload_reservations reservation
  where reservation.id = p_reservation_id;
  if not found then
    raise exception 'Storage reservation does not exist'
      using errcode = 'P0001', detail = 'STORAGE_OBJECT_MISMATCH';
  end if;

  perform public.storage_require_writer(v_reservation.project_id, p_actor_user_id);
  if p_actual_bytes is null or p_actual_bytes <= 0 then
    raise exception 'Storage object metadata does not match the reservation'
      using errcode = 'P0001', detail = 'STORAGE_OBJECT_MISMATCH';
  end if;

  insert into public.account_storage_quotas (owner_id)
  values (v_reservation.owner_id)
  on conflict (owner_id) do nothing;
  select * into v_quota
  from public.account_storage_quotas quota
  where quota.owner_id = v_reservation.owner_id
  for update;

  select * into v_reservation
  from public.storage_upload_reservations reservation
  where reservation.id = p_reservation_id
  for update;

  if v_reservation.status = 'finalized' then
    select * into v_file from public.project_storage_files file where file.id = v_reservation.file_id;
    if v_reservation.actual_bytes is distinct from p_actual_bytes
       or v_reservation.source_entity_id is distinct from p_source_entity_id
       or v_file.object_created_at is distinct from p_object_created_at then
      raise exception 'Storage object metadata does not match the reservation'
        using errcode = 'P0001', detail = 'STORAGE_OBJECT_MISMATCH';
    end if;
    return jsonb_build_object(
      'fileId', v_file.id, 'ownerId', v_file.owner_id, 'projectId', v_file.project_id,
      'sizeBytes', v_file.size_bytes, 'reservationId', v_reservation.id, 'reused', true
    );
  end if;
  if v_reservation.status <> 'pending' or v_reservation.expires_at <= clock_timestamp() then
    raise exception 'Storage reservation expired'
      using errcode = 'P0001', detail = 'STORAGE_RESERVATION_EXPIRED';
  end if;

  select object.metadata ->> 'size' into v_storage_size
  from storage.objects as object
  where object.bucket_id = v_reservation.bucket_id
    and object.name = v_reservation.object_path;
  if not found or v_storage_size is null or v_storage_size !~ '^[0-9]+$' then
    raise exception 'Storage object metadata does not match the reservation'
      using errcode = 'P0001', detail = 'STORAGE_OBJECT_MISMATCH';
  end if;
  begin
    v_verified_bytes := v_storage_size::bigint;
  exception when numeric_value_out_of_range then
    raise exception 'Storage object metadata does not match the reservation'
      using errcode = 'P0001', detail = 'STORAGE_OBJECT_MISMATCH';
  end;
  if v_verified_bytes <= 0 or p_actual_bytes is distinct from v_verified_bytes then
    raise exception 'Storage object metadata does not match the reservation'
      using errcode = 'P0001', detail = 'STORAGE_OBJECT_MISMATCH';
  end if;

  if v_verified_bytes > v_quota.quota_bytes - v_quota.used_bytes - (v_quota.reserved_bytes - v_reservation.expected_bytes) then
    raise exception 'Project storage quota exceeded'
      using errcode = 'P0001', detail = 'STORAGE_QUOTA_EXCEEDED';
  end if;

  insert into public.project_storage_files (
    project_id, owner_id, bucket_id, object_path, display_name, mime_type,
    size_bytes, source_kind, source_entity_id, created_by, object_created_at
  ) values (
    v_reservation.project_id, v_reservation.owner_id, v_reservation.bucket_id,
    v_reservation.object_path, v_reservation.display_name, v_reservation.mime_type,
    v_verified_bytes, v_reservation.source_kind, p_source_entity_id,
    v_reservation.requested_by, p_object_created_at
  ) on conflict (bucket_id, object_path) do nothing
  returning * into v_file;

  if not found then
    select * into v_file from public.project_storage_files file
    where file.bucket_id = v_reservation.bucket_id and file.object_path = v_reservation.object_path
    for update;
    if v_file.project_id is distinct from v_reservation.project_id
       or v_file.owner_id is distinct from v_reservation.owner_id
       or v_file.display_name is distinct from v_reservation.display_name
       or v_file.mime_type is distinct from v_reservation.mime_type
       or v_file.size_bytes is distinct from v_verified_bytes
       or v_file.source_kind is distinct from v_reservation.source_kind
       or v_file.source_entity_id is distinct from p_source_entity_id
       or v_file.object_created_at is distinct from p_object_created_at then
      raise exception 'Storage object metadata does not match the reservation'
        using errcode = 'P0001', detail = 'STORAGE_OBJECT_MISMATCH';
    end if;
  end if;

  insert into public.project_storage_file_locations (
    file_id, project_id, owner_id, source_kind, source_entity_id
  ) values (
    v_file.id, v_reservation.project_id, v_reservation.owner_id,
    v_reservation.source_kind, p_source_entity_id
  ) on conflict (file_id, project_id, source_kind, source_entity_id) do nothing;

  update public.account_storage_quotas
  set used_bytes = used_bytes + v_verified_bytes,
      reserved_bytes = reserved_bytes - v_reservation.expected_bytes,
      updated_at = clock_timestamp()
  where owner_id = v_reservation.owner_id;

  update public.storage_upload_reservations
  set status = 'finalized', actual_bytes = v_verified_bytes, file_id = v_file.id,
      source_entity_id = p_source_entity_id, updated_at = clock_timestamp()
  where id = v_reservation.id;

  return jsonb_build_object(
    'fileId', v_file.id, 'ownerId', v_file.owner_id, 'projectId', v_file.project_id,
    'sizeBytes', v_file.size_bytes, 'reservationId', v_reservation.id, 'reused', false
  );
end;
$$;

create function public.storage_release_project_storage_upload(
  p_actor_user_id uuid,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.storage_upload_reservations%rowtype;
  v_quota public.account_storage_quotas%rowtype;
begin
  select * into v_reservation
  from public.storage_upload_reservations reservation
  where reservation.id = p_reservation_id;
  if not found then
    raise exception 'Storage reservation does not exist'
      using errcode = 'P0001', detail = 'STORAGE_OBJECT_MISMATCH';
  end if;
  perform public.storage_require_writer(v_reservation.project_id, p_actor_user_id);

  insert into public.account_storage_quotas (owner_id)
  values (v_reservation.owner_id)
  on conflict (owner_id) do nothing;
  select * into v_quota
  from public.account_storage_quotas quota
  where quota.owner_id = v_reservation.owner_id
  for update;

  select * into v_reservation
  from public.storage_upload_reservations reservation
  where reservation.id = p_reservation_id
  for update;

  if v_reservation.status = 'released' then
    return jsonb_build_object('reservationId', v_reservation.id, 'reused', true);
  end if;
  if v_reservation.status <> 'pending' then
    raise exception 'Storage object metadata does not match the reservation'
      using errcode = 'P0001', detail = 'STORAGE_OBJECT_MISMATCH';
  end if;

  update public.account_storage_quotas
  set reserved_bytes = reserved_bytes - v_reservation.expected_bytes,
      updated_at = clock_timestamp()
  where owner_id = v_reservation.owner_id;
  update public.storage_upload_reservations
  set status = 'released', updated_at = clock_timestamp()
  where id = v_reservation.id;

  return jsonb_build_object('reservationId', v_reservation.id, 'reused', false);
end;
$$;

create function public.reserve_project_storage_upload(
  p_project_id uuid, p_bucket_id text, p_object_path text, p_expected_bytes bigint,
  p_display_name text, p_mime_type text, p_source_kind text, p_source_entity_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.storage_reserve_project_storage_upload(
    auth.uid(), p_project_id, p_bucket_id, p_object_path, p_expected_bytes,
    p_display_name, p_mime_type, p_source_kind, p_source_entity_id
  );
$$;

create function public.finalize_project_storage_upload(
  p_reservation_id uuid, p_actual_bytes bigint, p_source_entity_id uuid default null,
  p_object_created_at timestamptz default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.storage_finalize_project_storage_upload(
    auth.uid(), p_reservation_id, p_actual_bytes, p_source_entity_id, p_object_created_at
  );
$$;

create function public.release_project_storage_upload(p_reservation_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.storage_release_project_storage_upload(auth.uid(), p_reservation_id);
$$;

create function public.service_reserve_project_storage_upload(
  p_actor_user_id uuid, p_project_id uuid, p_bucket_id text, p_object_path text,
  p_expected_bytes bigint, p_display_name text, p_mime_type text, p_source_kind text,
  p_source_entity_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.storage_reserve_project_storage_upload(
    p_actor_user_id, p_project_id, p_bucket_id, p_object_path, p_expected_bytes,
    p_display_name, p_mime_type, p_source_kind, p_source_entity_id
  );
$$;

create function public.service_finalize_project_storage_upload(
  p_actor_user_id uuid, p_reservation_id uuid, p_actual_bytes bigint,
  p_source_entity_id uuid default null, p_object_created_at timestamptz default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.storage_finalize_project_storage_upload(
    p_actor_user_id, p_reservation_id, p_actual_bytes, p_source_entity_id, p_object_created_at
  );
$$;

create function public.service_release_project_storage_upload(p_actor_user_id uuid, p_reservation_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.storage_release_project_storage_upload(p_actor_user_id, p_reservation_id);
$$;

create function public.account_storage_summary()
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
      'id', project.id, 'name', project.name, 'ownerName', coalesce(profile.full_name, profile.username, ''),
      'fileCount', count(file.id), 'usedBytes', coalesce(sum(file.size_bytes), 0), 'ownedByCurrentUser', true
    ) as row_json
    from public.projects project
    left join public.profiles profile on profile.id = project.owner_id
    left join public.project_storage_files file on file.project_id = project.id
      and file.owner_id = v_actor and file.lifecycle_status = 'active'
    where project.owner_id = v_actor
    group by project.id, project.name, profile.full_name, profile.username
  ) owned;

  select coalesce(jsonb_agg(row_json order by row_json ->> 'name'), '[]'::jsonb) into v_shared
  from (
    select jsonb_build_object(
      'id', project.id, 'name', project.name, 'ownerName', coalesce(profile.full_name, profile.username, ''),
      'fileCount', count(file.id), 'usedBytes', coalesce(sum(file.size_bytes), 0), 'ownedByCurrentUser', false
    ) as row_json
    from public.projects project
    join public.project_collaborators collaborator on collaborator.project_id = project.id
      and collaborator.user_id = v_actor and collaborator.accepted_at is not null
    left join public.profiles profile on profile.id = project.owner_id
    left join public.project_storage_files file on file.project_id = project.id
      and file.owner_id = project.owner_id and file.lifecycle_status = 'active'
    where project.owner_id <> v_actor
    group by project.id, project.name, profile.full_name, profile.username
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

create function public.account_storage_project_files(
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

  select count(*) into v_total
  from public.project_storage_files file
  where file.project_id = p_project_id and file.lifecycle_status = 'active'
    and (nullif(btrim(p_query), '') is null or file.display_name ilike '%' || btrim(p_query) || '%');

  select coalesce(jsonb_agg(row_json), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object(
      'id', file.id, 'name', file.display_name, 'mimeType', file.mime_type,
      'sizeBytes', file.size_bytes, 'sourceKind', file.source_kind,
      'sourceEntityId', file.source_entity_id, 'createdAt', file.created_at,
      'sourceAvailable', file.source_entity_id is null or exists (
        select 1 from public.project_storage_file_locations location
        where location.file_id = file.id and location.source_entity_id is not distinct from file.source_entity_id
      )
    ) as row_json
    from public.project_storage_files file
    where file.project_id = p_project_id and file.lifecycle_status = 'active'
      and (nullif(btrim(p_query), '') is null or file.display_name ilike '%' || btrim(p_query) || '%')
    order by
      case when p_sort = 'size_desc' then file.size_bytes end desc,
      case when p_sort = 'size_asc' then file.size_bytes end asc,
      case when p_sort = 'created_desc' then file.created_at end desc,
      case when p_sort = 'created_asc' then file.created_at end asc,
      case when p_sort = 'name_asc' then lower(file.display_name) end asc,
      case when p_sort = 'name_desc' then lower(file.display_name) end desc,
      file.id
    limit v_limit offset v_offset
  ) listed;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

-- Service reconciliation releases abandoned reservations. It locks the quota
-- before every counter change, just like finalize and explicit release.
create function public.reconcile_expired_project_storage_reservations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.storage_upload_reservations%rowtype;
  v_quota public.account_storage_quotas%rowtype;
  v_count integer := 0;
begin
  for v_reservation in
    select * from public.storage_upload_reservations reservation
    where reservation.status = 'pending' and reservation.expires_at <= clock_timestamp()
  loop
    select * into v_quota from public.account_storage_quotas quota
    where quota.owner_id = v_reservation.owner_id for update;
    select * into v_reservation from public.storage_upload_reservations reservation
    where reservation.id = v_reservation.id for update;
    if v_reservation.status <> 'pending' or v_reservation.expires_at > clock_timestamp() then
      continue;
    end if;
    update public.account_storage_quotas
    set reserved_bytes = reserved_bytes - v_reservation.expected_bytes,
        updated_at = clock_timestamp()
    where owner_id = v_reservation.owner_id;
    update public.storage_upload_reservations
    set status = 'expired', updated_at = clock_timestamp()
    where id = v_reservation.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- New library-media-files writes are project scoped. The original read and
-- delete policies remain for existing legacy user-only paths.
drop policy if exists "Authenticated users can upload their own files" on storage.objects;
drop policy if exists "Users can update their own files" on storage.objects;
drop policy if exists project_assets_storage_insert on storage.objects;
drop policy if exists project_assets_storage_update on storage.objects;
drop policy if exists "Authenticated uploads to tiptap-images" on storage.objects;
create policy library_media_files_project_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'library-media-files'
    and array_length(storage.foldername(name), 1) >= 2
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.storage_has_pending_upload_reservation(bucket_id, name)
  );
create policy library_media_files_project_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'library-media-files'
    and array_length(storage.foldername(name), 1) >= 2
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.storage_has_pending_upload_reservation(bucket_id, name)
  )
  with check (
    bucket_id = 'library-media-files'
    and array_length(storage.foldername(name), 1) >= 2
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.storage_has_pending_upload_reservation(bucket_id, name)
  );

create policy project_assets_storage_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-assets'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.storage_has_pending_upload_reservation(bucket_id, name)
  );
create policy project_assets_storage_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.storage_has_pending_upload_reservation(bucket_id, name)
  )
  with check (
    bucket_id = 'project-assets'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.storage_has_pending_upload_reservation(bucket_id, name)
  );
create policy tiptap_images_project_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tiptap-images'
    and array_length(storage.foldername(name), 1) >= 2
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.storage_has_pending_upload_reservation(bucket_id, name)
  );
create policy tiptap_images_project_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'tiptap-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.storage_has_pending_upload_reservation(bucket_id, name)
  )
  with check (
    bucket_id = 'tiptap-images'
    and array_length(storage.foldername(name), 1) >= 2
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.storage_has_pending_upload_reservation(bucket_id, name)
  );

revoke all on function public.storage_require_writer(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.storage_require_reader(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.storage_reserve_project_storage_upload(uuid, uuid, text, text, bigint, text, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.storage_finalize_project_storage_upload(uuid, uuid, bigint, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.storage_release_project_storage_upload(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.reserve_project_storage_upload(uuid, text, text, bigint, text, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.finalize_project_storage_upload(uuid, bigint, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.release_project_storage_upload(uuid) from public, anon, authenticated, service_role;
revoke all on function public.account_storage_summary() from public, anon, authenticated, service_role;
revoke all on function public.account_storage_project_files(uuid, text, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.service_reserve_project_storage_upload(uuid, uuid, text, text, bigint, text, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.service_finalize_project_storage_upload(uuid, uuid, bigint, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.service_release_project_storage_upload(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.reconcile_expired_project_storage_reservations() from public, anon, authenticated, service_role;
revoke all on function private.storage_has_pending_upload_reservation(text, text) from public, anon, authenticated, service_role;

grant execute on function public.reserve_project_storage_upload(uuid, text, text, bigint, text, text, text, uuid) to authenticated;
grant execute on function public.finalize_project_storage_upload(uuid, bigint, uuid, timestamptz) to authenticated;
grant execute on function public.release_project_storage_upload(uuid) to authenticated;
grant execute on function public.account_storage_summary() to authenticated;
grant execute on function public.account_storage_project_files(uuid, text, text, integer, integer) to authenticated;
grant execute on function private.storage_has_pending_upload_reservation(text, text) to authenticated;
grant execute on function public.service_reserve_project_storage_upload(uuid, uuid, text, text, bigint, text, text, text, uuid) to service_role;
grant execute on function public.service_finalize_project_storage_upload(uuid, uuid, bigint, uuid, timestamptz) to service_role;
grant execute on function public.service_release_project_storage_upload(uuid, uuid) to service_role;
grant execute on function public.reconcile_expired_project_storage_reservations() to service_role;
