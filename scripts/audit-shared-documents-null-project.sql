-- Read-only audit for legacy shared_documents rows that became inaccessible
-- after project-scoped RLS was added.
--
-- Run this with the service role in each environment before applying the
-- NOT NULL migration. Every row returned by the detail query needs an explicit
-- owner-approved disposition: authoritative project_id backfill or deletion
-- from a backup-approved maintenance script. Do not infer project_id from doc_id.

SELECT
  COUNT(*) AS null_project_row_count
FROM public.shared_documents
WHERE project_id IS NULL;

SELECT
  id,
  doc_id,
  owner_id,
  created_at
FROM public.shared_documents
WHERE project_id IS NULL
ORDER BY created_at, id;
