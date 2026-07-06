-- Fix projects_update_policy: prevent editors from reassigning owner_id (issue #153).
--
-- The prior policy (20260108000003_update_rls_for_collaboration.sql) allowed any
-- admin/editor collaborator to UPDATE a project but had no WITH CHECK clause, so
-- an editor could set owner_id = auth.uid(), gain is_project_owner() rights
-- everywhere, and then delete the project. This adds a WITH CHECK that pins the
-- new row's owner_id to the project's existing owner_id, so ownership can never
-- be transferred through the collaborator update path.

DROP POLICY IF EXISTS projects_update_policy ON public.projects;

CREATE POLICY "projects_update_policy"
  ON public.projects FOR UPDATE
  USING (
    id IN (
      SELECT project_id
      FROM public.project_collaborators
      WHERE user_id = auth.uid()
        AND role IN ('admin', 'editor')
        AND accepted_at IS NOT NULL
    )
  )
  WITH CHECK (
    id IN (
      SELECT project_id
      FROM public.project_collaborators
      WHERE user_id = auth.uid()
        AND role IN ('admin', 'editor')
        AND accepted_at IS NOT NULL
    )
    AND owner_id = (SELECT p.owner_id FROM public.projects p WHERE p.id = projects.id)
  );

COMMENT ON POLICY "projects_update_policy" ON public.projects IS
  'Admin/editor collaborators can update project metadata but cannot reassign owner_id';
