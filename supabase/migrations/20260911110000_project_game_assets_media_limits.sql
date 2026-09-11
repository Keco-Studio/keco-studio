insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-assets',
  'project-assets',
  false,
  104857600,
  array[
    'image/png','image/jpeg','image/gif','image/webp','image/svg+xml',
    'video/mp4','audio/mpeg','audio/mp4','audio/wav','audio/ogg',
    'application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain','text/csv','application/zip','application/json','image/vnd.adobe.photoshop'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy project_assets_storage_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-assets'
    and array_length(storage.foldername(storage.objects.name), 1) = 2
    and exists (
      select 1 from public.projects project
      where project.id::text = (storage.foldername(storage.objects.name))[2]
        and (
          project.owner_id = (select auth.uid())
          or exists (
            select 1 from public.project_collaborators collaborator
            where collaborator.project_id = project.id
              and collaborator.user_id = (select auth.uid())
              and collaborator.accepted_at is not null
          )
        )
    )
  );

create policy project_assets_storage_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-assets'
    and array_length(storage.foldername(storage.objects.name), 1) = 2
    and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.projects project
      where project.id::text = (storage.foldername(storage.objects.name))[2]
        and (
          project.owner_id = (select auth.uid())
          or exists (
            select 1 from public.project_collaborators collaborator
            where collaborator.project_id = project.id
              and collaborator.user_id = (select auth.uid())
              and collaborator.accepted_at is not null
              and collaborator.role in ('admin', 'editor')
          )
        )
    )
  );

create policy project_assets_storage_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'project-assets'
    and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'project-assets'
    and array_length(storage.foldername(storage.objects.name), 1) = 2
    and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.projects project
      where project.id::text = (storage.foldername(storage.objects.name))[2]
        and (
          project.owner_id = (select auth.uid())
          or exists (
            select 1 from public.project_collaborators collaborator
            where collaborator.project_id = project.id
              and collaborator.user_id = (select auth.uid())
              and collaborator.accepted_at is not null
              and collaborator.role in ('admin', 'editor')
          )
        )
    )
  );

create policy project_assets_storage_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-assets'
    and array_length(storage.foldername(storage.objects.name), 1) = 2
    and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.projects project
      where project.id::text = (storage.foldername(storage.objects.name))[2]
        and (
          project.owner_id = (select auth.uid())
          or exists (
            select 1 from public.project_collaborators collaborator
            where collaborator.project_id = project.id
              and collaborator.user_id = (select auth.uid())
              and collaborator.accepted_at is not null
              and collaborator.role in ('admin', 'editor')
          )
        )
    )
  );

alter table public.project_game_assets
  add column if not exists storage_bucket text not null default 'library-media-files';

alter table public.project_game_assets
  drop constraint if exists project_game_assets_storage_bucket_check;

alter table public.project_game_assets
  add constraint project_game_assets_storage_bucket_check
  check (storage_bucket in ('library-media-files', 'project-assets'));

alter table public.project_game_assets
  drop constraint if exists project_game_assets_storage_path_key;

alter table public.project_game_assets
  add constraint project_game_assets_storage_bucket_path_key
  unique (storage_bucket, storage_path);

alter table public.project_game_assets
  drop constraint if exists project_game_assets_file_size_check;

update public.project_game_assets
set mime_type = case mime_type
  when 'image/jpg' then 'image/jpeg'
  when 'audio/x-m4a' then 'audio/mp4'
  else mime_type
end
where mime_type in ('image/jpg', 'audio/x-m4a');

alter table public.project_game_assets
  add constraint project_game_assets_file_size_check
  check (
    file_size > 0 and (
      (mime_type = 'image/vnd.adobe.photoshop' and file_size <= 104857600)
      or (mime_type like 'image/%' and file_size <= 10485760)
      or (mime_type like 'text/%' and file_size <= 10485760)
      or (mime_type = 'application/json' and file_size <= 10485760)
      or (mime_type like 'audio/%' and file_size <= 52428800)
      or (mime_type = 'video/mp4' and file_size <= 104857600)
      or (mime_type = 'application/zip' and file_size <= 104857600)
      or (mime_type like 'application/%' and mime_type not in ('application/zip', 'application/json') and file_size <= 26214400)
    )
  );

alter table public.project_game_assets
  drop constraint if exists project_game_assets_mime_type_check;

alter table public.project_game_assets
  add constraint project_game_assets_mime_type_check
  check (mime_type in (
    'image/png','image/jpeg','image/gif','image/webp','image/svg+xml',
    'video/mp4','audio/mpeg','audio/mp4','audio/wav','audio/ogg',
    'application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain','text/csv','application/zip','application/json','image/vnd.adobe.photoshop'
  ));

-- Recreate the registration RPC with bucket-aware media validation. This is a
-- forward migration because the prior RPC migration may already be applied.
-- RETURNS TABLE exposes storage_path as a PL/pgSQL variable, which made
-- ON CONFLICT (storage_path) ambiguous against the table column.
create or replace function public.mcp_register_project_game_asset(
  p_project_id uuid,
  p_name text,
  p_category text,
  p_mime_type text,
  p_storage_path text,
  p_sha256 text,
  p_width integer,
  p_height integer,
  p_has_transparency boolean,
  p_file_size bigint
)
returns table (
  id uuid, project_id uuid, created_by uuid, name text, category text,
  status text, mime_type text, storage_path text, sha256 text,
  width integer, height integer, has_transparency boolean, file_size bigint,
  created_at timestamptz, updated_at timestamptz, reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_actor uuid := auth.uid();
  v_storage_bucket text;
  v_row public.project_game_assets%rowtype;
  v_inserted boolean := false;
begin
  if auth.uid() is null or not (
    exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = v_actor)
    or exists (
      select 1 from public.project_collaborators collaborator
      where collaborator.project_id = p_project_id
        and collaborator.user_id = v_actor
        and collaborator.accepted_at is not null
        and collaborator.role in ('admin', 'editor')
    )
  ) then
    raise exception 'PROJECT_WRITE_FORBIDDEN' using errcode = 'KA401';
  end if;

  select object.bucket_id into v_storage_bucket
  from storage.objects object
  where object.name = p_storage_path
    and object.bucket_id in ('project-assets', 'library-media-files')
  order by (object.bucket_id = 'project-assets') desc
  limit 1;

  if p_storage_path not like auth.uid()::text || '/' || p_project_id::text || '/%'
     or char_length(btrim(p_name)) not between 1 and 255
     or p_category not in ('character','icon','ui','map','prop','vfx','spritesheet','media')
     or p_mime_type is null
     or p_mime_type not in (
       'image/png','image/jpeg','image/gif','image/webp','image/svg+xml',
       'video/mp4','audio/mpeg','audio/mp4','audio/wav','audio/ogg',
       'application/pdf','application/msword',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.ms-excel',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.ms-powerpoint',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation',
       'text/plain','text/csv','application/zip','application/json','image/vnd.adobe.photoshop'
     )
     or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$'
     or p_file_size not between 1 and 104857600
     or v_storage_bucket is null
     or (v_storage_bucket = 'library-media-files' and (
       p_mime_type not in ('image/png','image/jpeg','image/gif','image/webp','image/svg+xml')
       or p_file_size > 5242880
     ))
     or (v_storage_bucket = 'project-assets' and (
       (p_mime_type in ('image/png','image/jpeg','image/gif','image/webp','image/svg+xml','application/json','text/plain','text/csv') and p_file_size > 10485760)
       or (p_mime_type like 'application/%' and p_mime_type not in ('application/zip','application/json') and p_file_size > 26214400)
       or (p_mime_type like 'audio/%' and p_file_size > 52428800)
     ))
     or (p_width is not null and p_width <= 0)
     or (p_height is not null and p_height <= 0) then
    raise exception 'Invalid project asset metadata' using errcode = '22023';
  end if;

  insert into public.project_game_assets (
    project_id, created_by, name, category, status, mime_type, storage_bucket,
    storage_path, sha256, width, height, has_transparency, file_size
  ) values (
    p_project_id, v_actor, p_name, p_category, 'ready', p_mime_type,
    v_storage_bucket, p_storage_path, p_sha256, p_width, p_height,
    p_has_transparency, p_file_size
  )
  on conflict (storage_bucket, storage_path) do nothing
  returning * into v_row;
  v_inserted := found;

  if not v_inserted then
    select * into v_row
    from public.project_game_assets asset
    where asset.storage_bucket = v_storage_bucket
      and asset.storage_path = p_storage_path;
    if v_row.project_id is distinct from p_project_id
       or v_row.created_by is distinct from v_actor
       or v_row.name is distinct from p_name
       or v_row.category is distinct from p_category
       or v_row.status is distinct from 'ready'
       or v_row.mime_type is distinct from p_mime_type
       or v_row.storage_bucket is distinct from v_storage_bucket
       or v_row.sha256 is distinct from p_sha256
       or v_row.width is distinct from p_width
       or v_row.height is distinct from p_height
       or v_row.has_transparency is distinct from p_has_transparency
       or v_row.file_size is distinct from p_file_size then
      raise exception 'ASSET_REGISTRATION_CONFLICT' using errcode = 'KA409';
    end if;
  end if;

  return query select
    v_row.id, v_row.project_id, v_row.created_by, v_row.name, v_row.category,
    v_row.status, v_row.mime_type, v_row.storage_path, v_row.sha256,
    v_row.width, v_row.height, v_row.has_transparency, v_row.file_size,
    v_row.created_at, v_row.updated_at, not v_inserted;
end;
$$;
