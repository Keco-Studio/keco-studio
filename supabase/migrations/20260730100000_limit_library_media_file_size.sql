-- Keep the storage bucket limit aligned with the MediaFileUpload and MCP image
-- upload contract. Existing objects are not modified.
update storage.buckets
set file_size_limit = 5242880
where id = 'library-media-files';
