-- Keco MCP Phase 2 read/search foundation and distributed telemetry.

create extension if not exists pg_trgm with schema extensions;

create table public.mcp_rate_limit_buckets (
  actor_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  operation_class text not null check (operation_class in ('static', 'read', 'write', 'search')),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (actor_id, project_id, operation_class, window_started_at)
);

create table public.mcp_audit_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  request_id uuid not null,
  actor_id uuid not null,
  project_id uuid not null,
  client_id text,
  event_type text not null check (event_type in ('admitted', 'completed')),
  operation text not null check (length(operation) between 1 and 100),
  operation_class text not null check (operation_class in ('static', 'read', 'write', 'search')),
  outcome text not null check (outcome in ('admitted', 'succeeded', 'failed', 'rate_limited')),
  error_code text,
  request_bytes integer check (request_bytes is null or request_bytes between 0 and 262143),
  response_bytes integer check (response_bytes is null or response_bytes between 0 and 1048575),
  total_ms integer check (total_ms is null or total_ms between 0 and 3600000),
  database_ms integer check (database_ms is null or database_ms between 0 and 3600000),
  embedding_ms integer check (embedding_ms is null or embedding_ms between 0 and 3600000),
  serialization_ms integer check (serialization_ms is null or serialization_ms between 0 and 3600000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (client_id is null or length(client_id) <= 256),
  check (error_code is null or length(error_code) <= 100),
  check (pg_catalog.octet_length(metadata::text) <= 4096)
);

create index mcp_rate_limit_cleanup_idx
  on public.mcp_rate_limit_buckets (window_started_at);
create index mcp_audit_operation_idx
  on public.mcp_audit_events (operation_id, created_at, id);
create index mcp_audit_project_time_idx
  on public.mcp_audit_events (project_id, created_at desc);
create index mcp_audit_failures_idx
  on public.mcp_audit_events (created_at desc, error_code)
  where outcome = 'failed';

alter table public.mcp_rate_limit_buckets enable row level security;
alter table public.mcp_audit_events enable row level security;
revoke all on table public.mcp_rate_limit_buckets from public, anon, authenticated;
revoke all on table public.mcp_audit_events from public, anon, authenticated;

create or replace function public.mcp_prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.mcp_cleanup', true) = 'on' and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'MCP audit events are append-only' using errcode = '42501';
end;
$$;

create trigger mcp_audit_events_append_only
before update or delete on public.mcp_audit_events
for each row execute function public.mcp_prevent_audit_mutation();

create or replace function public.mcp_current_project_role(p_project_id uuid)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when p.owner_id = (select auth.uid()) then 'admin'
    else pc.role
  end
  from public.projects p
  left join public.project_collaborators pc
    on pc.project_id = p.id
   and pc.user_id = (select auth.uid())
   and pc.accepted_at is not null
  where p.id = p_project_id
    and (p.owner_id = (select auth.uid()) or pc.user_id is not null)
  limit 1
$$;

revoke all on function public.mcp_current_project_role(uuid) from public, anon;
grant execute on function public.mcp_current_project_role(uuid) to authenticated, service_role;

create or replace function public.mcp_begin_operation(
  p_project_id uuid,
  p_operation text,
  p_operation_class text,
  p_request_id uuid,
  p_client_id text default null,
  p_request_bytes integer default null
)
returns table (
  operation_id uuid,
  remaining integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_limit integer;
  v_window timestamptz := date_trunc('minute', pg_catalog.clock_timestamp());
  v_count integer;
  v_operation_id uuid := gen_random_uuid();
begin
  if v_actor is null or public.mcp_current_project_role(p_project_id) is null then
    raise exception 'Project access revoked' using errcode = '42501';
  end if;
  if p_operation is null or length(p_operation) not between 1 and 100
    or p_operation !~ '^[a-z][a-z0-9_]*$'
    or p_request_id is null
    or p_client_id is not null and length(p_client_id) > 256
    or p_request_bytes is not null and (p_request_bytes < 0 or p_request_bytes >= 262144) then
    raise exception 'Invalid MCP operation metadata' using errcode = '22023';
  end if;

  v_limit := case p_operation_class
    when 'static' then 240
    when 'read' then 120
    when 'write' then 30
    when 'search' then 20
    else null
  end;
  if v_limit is null then
    raise exception 'Invalid MCP operation class' using errcode = '22023';
  end if;

  insert into public.mcp_rate_limit_buckets (
    actor_id, project_id, operation_class, window_started_at, request_count
  ) values (v_actor, p_project_id, p_operation_class, v_window, 1)
  on conflict (actor_id, project_id, operation_class, window_started_at)
  do update set
    request_count = public.mcp_rate_limit_buckets.request_count + 1,
    updated_at = pg_catalog.clock_timestamp()
  where public.mcp_rate_limit_buckets.request_count < v_limit
  returning request_count into v_count;

  if v_count is null then
    insert into public.mcp_audit_events (
      operation_id, request_id, actor_id, project_id, client_id, event_type,
      operation, operation_class, outcome, error_code, request_bytes
    ) values (
      v_operation_id, p_request_id, v_actor, p_project_id, p_client_id, 'completed',
      p_operation, p_operation_class, 'rate_limited', 'RATE_LIMITED', p_request_bytes
    );
    return query
      select v_operation_id, -1, v_window + interval '1 minute';
    return;
  end if;

  insert into public.mcp_audit_events (
    operation_id, request_id, actor_id, project_id, client_id, event_type,
    operation, operation_class, outcome, request_bytes
  ) values (
    v_operation_id, p_request_id, v_actor, p_project_id, p_client_id, 'admitted',
    p_operation, p_operation_class, 'admitted', p_request_bytes
  );

  return query select v_operation_id, v_limit - v_count, v_window + interval '1 minute';
end;
$$;

create or replace function public.mcp_complete_operation(
  p_operation_id uuid,
  p_outcome text,
  p_error_code text default null,
  p_response_bytes integer default null,
  p_total_ms integer default null,
  p_database_ms integer default null,
  p_embedding_ms integer default null,
  p_serialization_ms integer default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.mcp_audit_events%rowtype;
begin
  select * into v_source
  from public.mcp_audit_events
  where operation_id = p_operation_id and event_type = 'admitted'
  order by created_at, id limit 1;

  if not found or v_source.actor_id is distinct from (select auth.uid()) then
    raise exception 'MCP operation not found' using errcode = '42501';
  end if;
  if p_outcome not in ('succeeded', 'failed')
    or p_error_code is not null and length(p_error_code) > 100
    or p_response_bytes is not null and (p_response_bytes < 0 or p_response_bytes >= 1048576)
    or pg_catalog.octet_length(coalesce(p_metadata, '{}'::jsonb)::text) > 4096
    or coalesce(p_metadata, '{}'::jsonb) ?| array[
      'authorization', 'token', 'accessToken', 'refreshToken', 'query', 'markdown', 'values'
    ] then
    raise exception 'Invalid MCP completion metadata' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.mcp_audit_events
    where operation_id = p_operation_id and event_type = 'completed'
  ) then
    raise exception 'MCP operation is already complete' using errcode = '23505';
  end if;

  insert into public.mcp_audit_events (
    operation_id, request_id, actor_id, project_id, client_id, event_type,
    operation, operation_class, outcome, error_code, response_bytes,
    total_ms, database_ms, embedding_ms, serialization_ms, metadata
  ) values (
    v_source.operation_id, v_source.request_id, v_source.actor_id,
    v_source.project_id, v_source.client_id, 'completed', v_source.operation,
    v_source.operation_class, p_outcome, p_error_code, p_response_bytes,
    p_total_ms, p_database_ms, p_embedding_ms, p_serialization_ms,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function public.mcp_read_project_structure(p_project_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  with allowed as (
    select p.id, p.name, p.description, p.updated_at
    from public.projects p
    where p.id = p_project_id and public.mcp_current_project_role(p.id) is not null
  ), folders_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'name', f.name, 'updatedAt', f.updated_at
    ) order by f.name, f.id), '[]'::jsonb) value
    from public.folders f join allowed a on a.id = f.project_id
  ), tables_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'name', l.name, 'description', l.description,
      'folderId', l.folder_id, 'updatedAt', l.updated_at,
      'fields', coalesce((select jsonb_agg(jsonb_build_object(
        'id', fd.id, 'label', fd.label, 'dataType', fd.data_type,
        'section', fd.section, 'sectionId', fd.section_id,
        'description', fd.description, 'required', fd.required,
        'enumOptions', fd.enum_options, 'referenceTableIds', fd.reference_libraries,
        'orderIndex', fd.order_index
      ) order by fd.order_index, fd.id)
      from public.library_field_definitions fd where fd.library_id = l.id), '[]'::jsonb)
    ) order by l.name, l.id), '[]'::jsonb) value
    from public.libraries l join allowed a on a.id = l.project_id
  ), documents_json as (
    select coalesce(jsonb_agg(item.value order by item.updated_at desc, item.id desc), '[]'::jsonb) value
    from (
      select d.id, d.updated_at, jsonb_build_object(
        'id', d.id, 'name', d.name, 'folderId', d.folder_id,
        'updatedAt', d.updated_at, 'epoch', d.collab_epoch,
        'revision', d.collab_revision
      ) value
      from public.documents d join allowed a on a.id = d.project_id
      order by d.updated_at desc, d.id desc limit 200
    ) item
  )
  select jsonb_build_object(
    'project', jsonb_build_object('id', a.id, 'name', a.name,
      'description', a.description, 'updatedAt', a.updated_at),
    'folders', f.value, 'tables', t.value, 'documents', d.value
  )
  from allowed a cross join folders_json f cross join tables_json t cross join documents_json d
$$;

create or replace function public.mcp_vector_search(
  p_project_id uuid,
  p_query_embedding vector(1536),
  p_limit integer default 10,
  p_min_score double precision default 0.2
)
returns table (
  source_type text,
  source_id text,
  content text,
  metadata jsonb,
  score double precision,
  updated_at timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if public.mcp_current_project_role(p_project_id) is null then
    raise exception 'Project access revoked' using errcode = '42501';
  end if;
  if p_limit not between 1 and 30 or p_min_score < 0 or p_min_score > 1 then
    raise exception 'Invalid search options' using errcode = '22023';
  end if;
  return query
  select c.source_type, c.source_id, left(c.content, 2000), c.metadata,
    (1 - (c.embedding <=> p_query_embedding))::double precision, c.updated_at
  from public.agent_embedding_chunks c
  where c.project_id = p_project_id
    and c.source_type in ('library_cell', 'library_row', 'library_schema',
      'design_document', 'project_document')
    and (1 - (c.embedding <=> p_query_embedding)) >= p_min_score
  order by c.embedding <=> p_query_embedding, c.id
  limit p_limit;
end;
$$;

create or replace function public.mcp_text_search(
  p_project_id uuid,
  p_query text,
  p_limit integer default 10
)
returns table (
  source_type text,
  source_id text,
  title text,
  excerpt text,
  score double precision,
  updated_at timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_query text := btrim(p_query);
begin
  if public.mcp_current_project_role(p_project_id) is null then
    raise exception 'Project access revoked' using errcode = '42501';
  end if;
  if v_query = '' or length(v_query) > 500 or p_limit not between 1 and 30 then
    raise exception 'Invalid search options' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select 'library_schema'::text source_type, l.id::text source_id,
      l.name title, left(concat_ws(' ', l.name, l.description,
        string_agg(fd.label || ' ' || coalesce(fd.description, ''), ' ')), 2000) body,
      l.updated_at
    from public.libraries l
    left join public.library_field_definitions fd on fd.library_id = l.id
    where l.project_id = p_project_id
    group by l.id
    union all
    select 'library_row', a.id::text, coalesce(nullif(a.name, ''), 'Untitled row'),
      left(concat_ws(' ', a.name, string_agg(v.value_json::text, ' ')), 2000), a.updated_at
    from public.library_assets a
    join public.libraries l on l.id = a.library_id
    left join public.library_asset_values v on v.asset_id = a.id
    where l.project_id = p_project_id
    group by a.id
    union all
    select 'project_document', d.id::text, d.name,
      left(concat_ws(' ', d.name, d.content), 2000), d.updated_at
    from public.documents d where d.project_id = p_project_id
  ), ranked as (
    select c.*,
      greatest(
        ts_rank_cd(to_tsvector('simple', coalesce(c.title, '') || ' ' || coalesce(c.body, '')),
          plainto_tsquery('simple', v_query))::double precision,
        extensions.similarity(lower(coalesce(c.title, '') || ' ' || coalesce(c.body, '')), lower(v_query))::double precision
      ) score
    from candidates c
    where to_tsvector('simple', coalesce(c.title, '') || ' ' || coalesce(c.body, ''))
          @@ plainto_tsquery('simple', v_query)
       or extensions.similarity(
            lower(coalesce(c.title, '') || ' ' || coalesce(c.body, '')),
            lower(v_query)
          ) > 0.1
       or position(lower(v_query) in lower(coalesce(c.title, '') || ' ' || coalesce(c.body, ''))) > 0
  )
  select r.source_type, r.source_id, r.title, left(r.body, 500), r.score, r.updated_at
  from ranked r order by r.score desc, r.updated_at desc, r.source_id
  limit p_limit;
end;
$$;

create or replace function public.mcp_cleanup_telemetry()
returns table (rate_buckets_deleted bigint, audit_events_deleted bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buckets bigint;
  v_audit bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  delete from public.mcp_rate_limit_buckets
  where window_started_at < pg_catalog.clock_timestamp() - interval '2 days';
  get diagnostics v_buckets = row_count;
  perform set_config('app.mcp_cleanup', 'on', true);
  delete from public.mcp_audit_events
  where created_at < pg_catalog.clock_timestamp() - interval '90 days';
  get diagnostics v_audit = row_count;
  return query select v_buckets, v_audit;
end;
$$;

create index if not exists idx_documents_project_updated_id
  on public.documents (project_id, updated_at desc, id desc);
create index if not exists idx_libraries_name_trgm
  on public.libraries using gin (lower(name) extensions.gin_trgm_ops);
create index if not exists idx_documents_name_trgm
  on public.documents using gin (lower(name) extensions.gin_trgm_ops);

revoke all on function public.mcp_begin_operation(uuid, text, text, uuid, text, integer)
  from public, anon;
revoke all on function public.mcp_complete_operation(uuid, text, text, integer, integer, integer, integer, integer, jsonb)
  from public, anon;
revoke all on function public.mcp_read_project_structure(uuid) from public, anon;
revoke all on function public.mcp_vector_search(uuid, vector, integer, double precision)
  from public, anon;
revoke all on function public.mcp_text_search(uuid, text, integer) from public, anon;
revoke all on function public.mcp_cleanup_telemetry() from public, anon, authenticated;

grant execute on function public.mcp_begin_operation(uuid, text, text, uuid, text, integer)
  to authenticated;
grant execute on function public.mcp_complete_operation(uuid, text, text, integer, integer, integer, integer, integer, jsonb)
  to authenticated;
grant execute on function public.mcp_read_project_structure(uuid) to authenticated;
grant execute on function public.mcp_vector_search(uuid, vector, integer, double precision)
  to authenticated;
grant execute on function public.mcp_text_search(uuid, text, integer) to authenticated;
grant execute on function public.mcp_cleanup_telemetry() to service_role;
