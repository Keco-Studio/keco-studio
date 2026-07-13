-- Version history list queries use metadata only. The snapshot JSONB GIN index
-- was never queried and grows with every saved version.
DROP INDEX IF EXISTS public.idx_library_versions_snapshot_data;
