-- Fix projects_update_policy: prevent editors from reassigning owner_id (issue #153).
--
-- The prior policy (20260108000003_update_rls_for_collaboration.sql) allowed any
-- admin/editor collaborator to UPDATE a project but had no WITH CHECK clause, so
-- an editor could set owner_id = auth.uid(), gain is_project_owner() rights
-- everywhere, and then delete the project.
--
-- Ownership immutability is enforced with a BEFORE UPDATE trigger rather than a
-- WITH CHECK subquery: a WITH CHECK that reads public.projects (to compare the
-- new owner_id against the current one) re-enters the projects RLS policy and
-- raises "infinite recursion detected in policy for relation projects". A
-- trigger can compare OLD.owner_id vs NEW.owner_id directly, needs no self-query,
-- and cannot be bypassed by the collaborator update path.

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
  );

-- Enforce owner_id immutability through UPDATE (only DELETE + re-create, or a
-- SECURITY DEFINER transfer function, may change ownership).
CREATE OR REPLACE FUNCTION public.projects_prevent_owner_reassignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'owner_id is immutable and cannot be reassigned via UPDATE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_prevent_owner_reassignment ON public.projects;

CREATE TRIGGER projects_prevent_owner_reassignment
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.projects_prevent_owner_reassignment();

COMMENT ON POLICY "projects_update_policy" ON public.projects IS
  'Admin/editor collaborators can update project metadata; owner_id immutability is enforced by the projects_prevent_owner_reassignment trigger';
