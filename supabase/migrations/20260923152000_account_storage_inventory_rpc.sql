-- Give service-role maintenance jobs authoritative object ownership without
-- exposing the private storage schema through PostgREST.
create function public.service_account_storage_inventory(
  p_bucket_id text,
  p_offset integer default 0,
  p_limit integer default 100
)
returns table (
  bucket_id text,
  object_path text,
  size_bytes bigint,
  object_created_at timestamptz,
  mime_type text,
  uploader_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    object.bucket_id,
    object.name,
    case
      when object.metadata ->> 'size' ~ '^[0-9]+$'
        and (object.metadata ->> 'size')::numeric between 1 and 9223372036854775807
        then (object.metadata ->> 'size')::bigint
      else null::bigint
    end,
    object.created_at,
    coalesce(nullif(object.metadata ->> 'mimetype', ''), 'application/octet-stream'),
    coalesce(
      object.owner,
      case
        when object.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then object.owner_id::uuid
        else null::uuid
      end
    )
  from storage.objects object
  where object.bucket_id = p_bucket_id
    and object.bucket_id in (
      'library-media-files', 'project-assets', 'map-assets',
      'character-assets', 'tiptap-images'
    )
  order by object.name
  limit least(greatest(p_limit, 1), 1000)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.service_account_storage_inventory(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.service_account_storage_inventory(text, integer, integer)
  to service_role;
