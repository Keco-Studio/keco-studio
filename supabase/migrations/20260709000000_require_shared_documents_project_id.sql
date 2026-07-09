-- Require shared_documents.project_id after explicit per-environment audit.
--
-- Before applying this migration outside local/CI, run:
--   scripts/audit-shared-documents-null-project.sql
-- with the service role and resolve every NULL-project row it reports. This
-- migration deliberately fails if any NULL remains. It never infers a project,
-- backfills, or deletes legacy rows.

DO $$
DECLARE
  null_project_count integer;
BEGIN
  SELECT COUNT(*)
  INTO null_project_count
  FROM public.shared_documents
  WHERE project_id IS NULL;

  IF null_project_count > 0 THEN
    RAISE EXCEPTION
      'shared_documents.project_id contains % NULL row(s). Run scripts/audit-shared-documents-null-project.sql and resolve each row explicitly before applying NOT NULL.',
      null_project_count;
  END IF;
END $$;

ALTER TABLE public.shared_documents
  ALTER COLUMN project_id SET NOT NULL;

COMMENT ON COLUMN public.shared_documents.project_id IS
  'Required project scope for shared document RLS. Audit and explicitly resolve legacy NULL rows before enforcing this constraint.';
