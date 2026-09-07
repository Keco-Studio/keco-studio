-- Resumable, atomic transport for Yjs updates larger than the normal append limit.

create table public.document_yjs_update_uploads (
  id uuid primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  epoch bigint not null check (epoch >= 0),
  created_by uuid not null references auth.users(id),
  total_bytes integer not null check (total_bytes between 262145 and 8388608),
  chunk_count integer not null check (chunk_count between 2 and 64),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'uploading' check (status in ('uploading', 'committed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz default (now() + interval '24 hours'),
  check (chunk_count = ((total_bytes + 131071) / 131072)),
  check ((status = 'committed') = (expires_at is null))
);

create table public.document_yjs_update_upload_chunks (
  upload_id uuid not null references public.document_yjs_update_uploads(id) on delete cascade,
  chunk_index integer not null check (chunk_index between 0 and 63),
  chunk_data bytea not null,
  byte_count integer not null check (byte_count between 1 and 131072),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (upload_id, chunk_index),
  check (byte_count = pg_catalog.octet_length(chunk_data))
);

alter table public.document_yjs_update_uploads enable row level security;
alter table public.document_yjs_update_upload_chunks enable row level security;
revoke all on table public.document_yjs_update_uploads from anon, authenticated;
revoke all on table public.document_yjs_update_upload_chunks from anon, authenticated;

create or replace function public.assert_document_yjs_update_upload_identity(
  p_epoch bigint,
  p_total_bytes integer,
  p_chunk_count integer,
  p_sha256 text
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_epoch is null or p_epoch < 0
    or p_total_bytes is null or p_total_bytes < 262145 or p_total_bytes > 8388608
    or p_chunk_count is null or p_chunk_count < 2 or p_chunk_count > 64
    or p_chunk_count <> ((p_total_bytes + 131071) / 131072)
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Document update upload identity is invalid'
      using errcode = '22023';
  end if;
end;
$$;

create or replace function public.cleanup_expired_document_yjs_update_uploads(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'Cleanup limit is invalid' using errcode = '22023';
  end if;
  with expired as (
    select upload.id
    from public.document_yjs_update_uploads upload
    where upload.status = 'uploading'
      and upload.expires_at <= now()
    order by upload.expires_at, upload.id
    for update skip locked
    limit p_limit
  )
  delete from public.document_yjs_update_uploads upload
  using expired
  where upload.id = expired.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.prepare_document_yjs_update_upload(
  p_upload_id uuid,
  p_document_id uuid,
  p_epoch bigint,
  p_total_bytes integer,
  p_chunk_count integer,
  p_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_upload public.document_yjs_update_uploads%rowtype;
  v_existing public.document_yjs_updates%rowtype;
  v_existing_bytes bytea;
  v_existing_found boolean := false;
  v_user_id uuid := (select auth.uid());
  v_received integer[];
begin
  perform public.assert_document_yjs_update_upload_identity(
    p_epoch, p_total_bytes, p_chunk_count, p_sha256
  );
  if p_upload_id is null or p_document_id is null then
    raise exception 'Document update upload identity is invalid' using errcode = '22023';
  end if;

  delete from public.document_yjs_update_uploads upload
  where upload.status = 'uploading' and upload.expires_at <= now()
    and upload.id in (
      select candidate.id
      from public.document_yjs_update_uploads candidate
      where candidate.status = 'uploading' and candidate.expires_at <= now()
      order by candidate.expires_at, candidate.id
      for update skip locked
      limit 10
    );

  select document.* into v_document
  from public.documents document
  where document.id = p_document_id
  for update;
  if not found or v_user_id is null or not (
    public.is_project_owner(v_document.project_id, v_user_id)
    or public.is_editor_or_admin_collaborator(v_document.project_id, v_user_id)
  ) then
    raise exception 'Document not found or not writable' using errcode = '42501';
  end if;
  if v_document.collab_epoch <> p_epoch then
    raise exception 'Document collaboration epoch changed' using errcode = 'PT409';
  end if;

  select update_row.* into v_existing
  from public.document_yjs_updates update_row
  where update_row.id = p_upload_id
  for update;
  v_existing_found := found;
  if v_existing_found then
    begin
      v_existing_bytes := pg_catalog.decode(v_existing.update_data, 'base64');
    exception when others then
      raise exception 'Document update id belongs to another state' using errcode = '22023';
    end;
    if v_existing.document_id <> p_document_id
      or v_existing.epoch <> p_epoch
      or v_existing.created_by is distinct from v_user_id
      or pg_catalog.octet_length(v_existing_bytes) <> p_total_bytes
      or pg_catalog.encode(extensions.digest(v_existing_bytes, 'sha256'), 'hex') <> p_sha256
    then
      raise exception 'Document update id belongs to another state' using errcode = '22023';
    end if;
  end if;

  insert into public.document_yjs_update_uploads (
    id, document_id, epoch, created_by, total_bytes, chunk_count, sha256, status, expires_at
  ) values (
    p_upload_id, p_document_id, p_epoch, v_user_id,
    p_total_bytes, p_chunk_count, p_sha256,
    case when v_existing_found then 'committed' else 'uploading' end,
    case when v_existing_found then null else now() + interval '24 hours' end
  ) on conflict (id) do nothing;

  select upload.* into v_upload
  from public.document_yjs_update_uploads upload
  where upload.id = p_upload_id
  for update;
  if v_upload.document_id <> p_document_id or v_upload.epoch <> p_epoch
    or v_upload.created_by <> v_user_id or v_upload.total_bytes <> p_total_bytes
    or v_upload.chunk_count <> p_chunk_count or v_upload.sha256 <> p_sha256
  then
    raise exception 'Document update upload identity changed' using errcode = '22023';
  end if;

  if v_existing_found and v_upload.status <> 'committed' then
    update public.document_yjs_update_uploads
    set status = 'committed', updated_at = now(), expires_at = null
    where id = p_upload_id;
    delete from public.document_yjs_update_upload_chunks where upload_id = p_upload_id;
    return jsonb_build_object('status', 'committed', 'receivedIndexes', jsonb_build_array());
  end if;
  if v_upload.status = 'committed' then
    return jsonb_build_object('status', 'committed', 'receivedIndexes', jsonb_build_array());
  end if;
  update public.document_yjs_update_uploads
  set updated_at = now(), expires_at = now() + interval '24 hours'
  where id = p_upload_id;
  select coalesce(array_agg(chunk.chunk_index order by chunk.chunk_index), array[]::integer[])
    into v_received
  from public.document_yjs_update_upload_chunks chunk
  where chunk.upload_id = p_upload_id;
  return jsonb_build_object(
    'status', case when cardinality(v_received) = p_chunk_count then 'ready' else 'uploading' end,
    'receivedIndexes', to_jsonb(v_received)
  );
end;
$$;

create or replace function public.put_document_yjs_update_chunk(
  p_upload_id uuid,
  p_document_id uuid,
  p_epoch bigint,
  p_total_bytes integer,
  p_chunk_count integer,
  p_sha256 text,
  p_chunk_index integer,
  p_chunk_base64 text,
  p_chunk_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_upload public.document_yjs_update_uploads%rowtype;
  v_existing public.document_yjs_update_upload_chunks%rowtype;
  v_user_id uuid := (select auth.uid());
  v_chunk bytea;
  v_expected_bytes integer;
  v_chunk_hash text;
  v_received_count integer;
begin
  perform public.assert_document_yjs_update_upload_identity(
    p_epoch, p_total_bytes, p_chunk_count, p_sha256
  );
  if p_chunk_index is null or p_chunk_index < 0 or p_chunk_index >= p_chunk_count
    or p_chunk_sha256 is null or p_chunk_sha256 !~ '^[0-9a-f]{64}$'
    or p_chunk_base64 is null or length(p_chunk_base64) = 0
    or length(p_chunk_base64) > 174764 or length(p_chunk_base64) % 4 <> 0
    or p_chunk_base64 !~ '^[A-Za-z0-9+/]*={0,2}$'
  then
    raise exception 'Document update chunk is invalid' using errcode = '22023';
  end if;
  begin
    v_chunk := pg_catalog.decode(p_chunk_base64, 'base64');
  exception when others then
    raise exception 'Document update chunk is invalid' using errcode = '22023';
  end;
  if pg_catalog.translate(pg_catalog.encode(v_chunk, 'base64'), E'\n\r', '') <> p_chunk_base64 then
    raise exception 'Document update chunk is not canonical' using errcode = '22023';
  end if;
  v_expected_bytes := case when p_chunk_index = p_chunk_count - 1
    then p_total_bytes - (p_chunk_index * 131072) else 131072 end;
  v_chunk_hash := pg_catalog.encode(extensions.digest(v_chunk, 'sha256'), 'hex');
  if pg_catalog.octet_length(v_chunk) <> v_expected_bytes or v_chunk_hash <> p_chunk_sha256 then
    raise exception 'Document update chunk identity is invalid' using errcode = '22023';
  end if;

  select document.* into v_document
  from public.documents document where document.id = p_document_id for update;
  if not found or v_user_id is null or not (
    public.is_project_owner(v_document.project_id, v_user_id)
    or public.is_editor_or_admin_collaborator(v_document.project_id, v_user_id)
  ) then
    raise exception 'Document not found or not writable' using errcode = '42501';
  end if;
  if v_document.collab_epoch <> p_epoch then
    raise exception 'Document collaboration epoch changed' using errcode = 'PT409';
  end if;
  select upload.* into v_upload from public.document_yjs_update_uploads upload
  where upload.id = p_upload_id for update;
  if not found or v_upload.status <> 'uploading' or v_upload.expires_at <= now() then
    raise exception 'Document update upload is not resumable' using errcode = 'PT409';
  end if;
  if v_upload.document_id <> p_document_id or v_upload.epoch <> p_epoch
    or v_upload.created_by <> v_user_id or v_upload.total_bytes <> p_total_bytes
    or v_upload.chunk_count <> p_chunk_count or v_upload.sha256 <> p_sha256
  then
    raise exception 'Document update upload identity changed' using errcode = '22023';
  end if;

  insert into public.document_yjs_update_upload_chunks (
    upload_id, chunk_index, chunk_data, byte_count, sha256
  ) values (
    p_upload_id, p_chunk_index, v_chunk, v_expected_bytes, v_chunk_hash
  ) on conflict (upload_id, chunk_index) do nothing;
  select chunk.* into v_existing
  from public.document_yjs_update_upload_chunks chunk
  where chunk.upload_id = p_upload_id and chunk.chunk_index = p_chunk_index;
  if v_existing.chunk_data <> v_chunk or v_existing.byte_count <> v_expected_bytes
    or v_existing.sha256 <> v_chunk_hash
  then
    raise exception 'Document update chunk conflicts with stored bytes' using errcode = '22023';
  end if;
  update public.document_yjs_update_uploads
  set updated_at = now(), expires_at = now() + interval '24 hours'
  where id = p_upload_id;
  select count(*) into v_received_count
  from public.document_yjs_update_upload_chunks chunk where chunk.upload_id = p_upload_id;
  return jsonb_build_object('receivedCount', v_received_count);
end;
$$;

create or replace function public.get_document_yjs_update_upload_status(
  p_upload_id uuid,
  p_document_id uuid,
  p_epoch bigint,
  p_total_bytes integer,
  p_chunk_count integer,
  p_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_upload public.document_yjs_update_uploads%rowtype;
  v_user_id uuid := (select auth.uid());
  v_missing integer[];
begin
  perform public.assert_document_yjs_update_upload_identity(
    p_epoch, p_total_bytes, p_chunk_count, p_sha256
  );
  select document.* into v_document
  from public.documents document where document.id = p_document_id;
  if not found or v_user_id is null or not (
    public.is_project_owner(v_document.project_id, v_user_id)
    or public.is_editor_or_admin_collaborator(v_document.project_id, v_user_id)
  ) then
    raise exception 'Document not found or not writable' using errcode = '42501';
  end if;
  if v_document.collab_epoch <> p_epoch then
    raise exception 'Document collaboration epoch changed' using errcode = 'PT409';
  end if;
  select upload.* into v_upload from public.document_yjs_update_uploads upload
  where upload.id = p_upload_id;
  if not found then
    return jsonb_build_object(
      'status', 'expired',
      'missingIndexes', to_jsonb(array(select generate_series(0, p_chunk_count - 1)))
    );
  end if;
  if v_upload.document_id <> p_document_id or v_upload.epoch <> p_epoch
    or v_upload.created_by <> v_user_id or v_upload.total_bytes <> p_total_bytes
    or v_upload.chunk_count <> p_chunk_count or v_upload.sha256 <> p_sha256
  then
    raise exception 'Document update upload identity changed' using errcode = '22023';
  end if;
  if v_upload.status = 'committed' then
    return jsonb_build_object('status', 'committed', 'missingIndexes', jsonb_build_array());
  end if;
  if v_upload.expires_at <= now() then
    delete from public.document_yjs_update_uploads where id = p_upload_id and status = 'uploading';
    return jsonb_build_object(
      'status', 'expired',
      'missingIndexes', to_jsonb(array(select generate_series(0, p_chunk_count - 1)))
    );
  end if;
  select coalesce(array_agg(index order by index), array[]::integer[])
    into v_missing
  from generate_series(0, p_chunk_count - 1) index
  where not exists (
    select 1 from public.document_yjs_update_upload_chunks chunk
    where chunk.upload_id = p_upload_id and chunk.chunk_index = index
  );
  return jsonb_build_object(
    'status', case when cardinality(v_missing) = 0 then 'ready' else 'uploading' end,
    'missingIndexes', to_jsonb(v_missing)
  );
end;
$$;

create or replace function public.finalize_document_yjs_update_upload(
  p_upload_id uuid,
  p_document_id uuid,
  p_epoch bigint,
  p_total_bytes integer,
  p_chunk_count integer,
  p_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_upload public.document_yjs_update_uploads%rowtype;
  v_existing public.document_yjs_updates%rowtype;
  v_user_id uuid := (select auth.uid());
  v_chunk_count integer;
  v_bytes bytea;
  v_update_base64 text;
begin
  perform public.assert_document_yjs_update_upload_identity(
    p_epoch, p_total_bytes, p_chunk_count, p_sha256
  );
  select document.* into v_document
  from public.documents document where document.id = p_document_id for update;
  if not found or v_user_id is null or not (
    public.is_project_owner(v_document.project_id, v_user_id)
    or public.is_editor_or_admin_collaborator(v_document.project_id, v_user_id)
  ) then
    raise exception 'Document not found or not writable' using errcode = '42501';
  end if;
  if v_document.collab_epoch <> p_epoch then
    raise exception 'Document collaboration epoch changed' using errcode = 'PT409';
  end if;
  select upload.* into v_upload from public.document_yjs_update_uploads upload
  where upload.id = p_upload_id for update;
  if not found or (v_upload.status = 'uploading' and v_upload.expires_at <= now()) then
    raise exception 'Document update upload is not resumable' using errcode = 'PT409';
  end if;
  if v_upload.document_id <> p_document_id or v_upload.epoch <> p_epoch
    or v_upload.created_by <> v_user_id or v_upload.total_bytes <> p_total_bytes
    or v_upload.chunk_count <> p_chunk_count or v_upload.sha256 <> p_sha256
  then
    raise exception 'Document update upload identity changed' using errcode = '22023';
  end if;
  if v_upload.status = 'committed' then
    return jsonb_build_object('status', 'committed');
  end if;

  select count(*), decode(
    string_agg(pg_catalog.encode(chunk_data, 'hex'), '' order by chunk_index),
    'hex'
  ) into v_chunk_count, v_bytes
  from public.document_yjs_update_upload_chunks
  where upload_id = p_upload_id;
  if v_chunk_count <> p_chunk_count
    or v_bytes is null
    or exists (
      select 1
      from public.document_yjs_update_upload_chunks chunk
      where chunk.upload_id = p_upload_id
        and (chunk.chunk_index < 0 or chunk.chunk_index >= p_chunk_count)
    )
    or exists (
      select 1
      from generate_series(0, p_chunk_count - 1) expected(index)
      where not exists (
        select 1
        from public.document_yjs_update_upload_chunks chunk
        where chunk.upload_id = p_upload_id
          and chunk.chunk_index = expected.index
      )
    )
  then
    raise exception 'Document update upload has missing chunks' using errcode = '22023';
  end if;
  if pg_catalog.octet_length(v_bytes) <> p_total_bytes
    or pg_catalog.encode(extensions.digest(v_bytes, 'sha256'), 'hex') <> p_sha256
  then
    raise exception 'Document update upload digest is invalid' using errcode = '22023';
  end if;
  v_update_base64 := pg_catalog.translate(pg_catalog.encode(v_bytes, 'base64'), E'\n\r', '');

  select update_row.* into v_existing from public.document_yjs_updates update_row
  where update_row.id = p_upload_id for update;
  if found and (
    v_existing.document_id <> p_document_id or v_existing.epoch <> p_epoch
    or v_existing.update_data <> v_update_base64
  ) then
    raise exception 'Document update id belongs to another state' using errcode = '22023';
  end if;
  if not found then
    insert into public.document_yjs_updates (
      id, document_id, epoch, update_data, created_by
    ) values (
      p_upload_id, p_document_id, p_epoch, v_update_base64, v_user_id
    );
  end if;
  update public.document_yjs_update_uploads
  set status = 'committed', updated_at = now(), expires_at = null
  where id = p_upload_id;
  delete from public.document_yjs_update_upload_chunks where upload_id = p_upload_id;
  return jsonb_build_object('status', 'committed');
end;
$$;

revoke all on function public.assert_document_yjs_update_upload_identity(bigint, integer, integer, text) from public;
revoke all on function public.prepare_document_yjs_update_upload(uuid, uuid, bigint, integer, integer, text) from public;
revoke all on function public.put_document_yjs_update_chunk(uuid, uuid, bigint, integer, integer, text, integer, text, text) from public;
revoke all on function public.get_document_yjs_update_upload_status(uuid, uuid, bigint, integer, integer, text) from public;
revoke all on function public.finalize_document_yjs_update_upload(uuid, uuid, bigint, integer, integer, text) from public;
revoke all on function public.cleanup_expired_document_yjs_update_uploads(integer) from public;
grant execute on function public.prepare_document_yjs_update_upload(uuid, uuid, bigint, integer, integer, text) to authenticated;
grant execute on function public.put_document_yjs_update_chunk(uuid, uuid, bigint, integer, integer, text, integer, text, text) to authenticated;
grant execute on function public.get_document_yjs_update_upload_status(uuid, uuid, bigint, integer, integer, text) to authenticated;
grant execute on function public.finalize_document_yjs_update_upload(uuid, uuid, bigint, integer, integer, text) to authenticated;
grant execute on function public.cleanup_expired_document_yjs_update_uploads(integer) to service_role;
