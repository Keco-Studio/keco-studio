-- Create tiptap-images bucket if it does not exist
insert into storage.buckets (id, name, public)
values ('tiptap-images', 'tiptap-images', true)
on conflict (id) do update set public = excluded.public;

-- Allow public read access to objects in tiptap-images
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Public read access for tiptap-images'
  ) then
    create policy "Public read access for tiptap-images"
    on storage.objects for select
    using (bucket_id = 'tiptap-images');
  end if;
end $$;

-- Allow authenticated users to upload to tiptap-images
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Authenticated uploads to tiptap-images'
  ) then
    create policy "Authenticated uploads to tiptap-images"
    on storage.objects for insert
    with check (bucket_id = 'tiptap-images');
  end if;
end $$;

