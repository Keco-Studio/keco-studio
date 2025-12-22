-- Create library-media-files bucket for user-uploaded files
insert into storage.buckets (id, name, public)
values ('library-media-files', 'library-media-files', true)
on conflict (id) do update set public = excluded.public;

-- Enable RLS on storage.objects (if not already enabled)
-- RLS is usually already enabled for storage.objects, so we skip this
-- alter table storage.objects enable row level security;

-- Allow public read access to objects in library-media-files
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Public read access for library-media-files'
  ) then
    create policy "Public read access for library-media-files"
    on storage.objects for select
    using (bucket_id = 'library-media-files');
  end if;
end $$;

-- Allow authenticated users to upload their own files
-- Files are stored with path pattern: {user_id}/{filename}
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Authenticated users can upload their own files'
  ) then
    create policy "Authenticated users can upload their own files"
    on storage.objects for insert
    with check (
      bucket_id = 'library-media-files' 
      and auth.uid()::text = (storage.foldername(name))[1]
    );
  end if;
end $$;

-- Allow users to update their own files
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Users can update their own files'
  ) then
    create policy "Users can update their own files"
    on storage.objects for update
    using (
      bucket_id = 'library-media-files' 
      and auth.uid()::text = (storage.foldername(name))[1]
    );
  end if;
end $$;

-- Allow users to delete their own files
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Users can delete their own files'
  ) then
    create policy "Users can delete their own files"
    on storage.objects for delete
    using (
      bucket_id = 'library-media-files' 
      and auth.uid()::text = (storage.foldername(name))[1]
    );
  end if;
end $$;

