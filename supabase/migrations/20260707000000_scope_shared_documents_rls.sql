-- Scope shared_documents access to project members.
--
-- shared_documents was created with blanket authenticated read/write policies.
-- Add a project_id parent and rebuild policies so RLS follows the same
-- owner/accepted-collaborator model as the rest of project-scoped data.

ALTER TABLE public.shared_documents
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_shared_documents_project_id
  ON public.shared_documents(project_id);

DROP POLICY IF EXISTS shared_documents_select_all ON public.shared_documents;
DROP POLICY IF EXISTS shared_documents_insert_all ON public.shared_documents;
DROP POLICY IF EXISTS shared_documents_update_all ON public.shared_documents;
DROP POLICY IF EXISTS "shared_documents_select_policy" ON public.shared_documents;
DROP POLICY IF EXISTS "shared_documents_insert_policy" ON public.shared_documents;
DROP POLICY IF EXISTS "shared_documents_update_policy" ON public.shared_documents;

CREATE POLICY "shared_documents_select_policy"
  ON public.shared_documents FOR SELECT
  USING (
    public.is_project_owner(project_id, auth.uid())
    OR public.is_accepted_collaborator(project_id, auth.uid())
  );

CREATE POLICY "shared_documents_insert_policy"
  ON public.shared_documents FOR INSERT
  WITH CHECK (
    public.is_project_owner(project_id, auth.uid())
    OR public.is_accepted_collaborator(project_id, auth.uid())
  );

CREATE POLICY "shared_documents_update_policy"
  ON public.shared_documents FOR UPDATE
  USING (
    public.is_project_owner(project_id, auth.uid())
    OR public.is_accepted_collaborator(project_id, auth.uid())
  )
  WITH CHECK (
    public.is_project_owner(project_id, auth.uid())
    OR public.is_accepted_collaborator(project_id, auth.uid())
  );

COMMENT ON POLICY "shared_documents_select_policy" ON public.shared_documents IS
  'Allow project owners and accepted collaborators to read shared documents';
COMMENT ON POLICY "shared_documents_insert_policy" ON public.shared_documents IS
  'Allow project owners and accepted collaborators to create shared documents';
COMMENT ON POLICY "shared_documents_update_policy" ON public.shared_documents IS
  'Allow project owners and accepted collaborators to update shared documents';
