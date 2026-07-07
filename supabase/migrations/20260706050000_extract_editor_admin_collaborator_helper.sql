-- Extract the repeated "accepted admin/editor collaborator" predicate into a
-- SECURITY DEFINER helper, then rebuild the policies that hand-copied it.
--
-- Rationale: the same
--   EXISTS (... pc.role IN ('admin','editor') AND pc.accepted_at IS NOT NULL)
-- predicate was inlined 4x in 20260706000000_fix_library_field_definitions_rls
-- and 2x in 20260706010000_fix_projects_update_owner_guard. That hand-rolled
-- drift is exactly what caused issues #143/#151/#153 — a role-hierarchy change
-- had to be edited in 6+ places in lockstep. Centralize it in one helper.
--
-- Additive (never edits the already-applied 20260706 migrations) so it works on
-- both fresh and previously-migrated databases. Mirrors the SECURITY DEFINER /
-- STABLE / SET search_path style of is_project_owner / is_accepted_collaborator.

CREATE OR REPLACE FUNCTION public.is_editor_or_admin_collaborator(p_project_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_result BOOLEAN;
BEGIN
  -- Direct query without RLS checks (SECURITY DEFINER bypasses RLS).
  SELECT EXISTS (
    SELECT 1 FROM public.project_collaborators
    WHERE project_id = p_project_id
      AND user_id = p_user_id
      AND role IN ('admin', 'editor')
      AND accepted_at IS NOT NULL
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_editor_or_admin_collaborator(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.is_editor_or_admin_collaborator(UUID, UUID) IS
  'Check if user is an accepted admin/editor collaborator. Uses SECURITY DEFINER to bypass RLS and prevent recursion.';

-- ============================================================================
-- Rebuild library_field_definitions write policies using the helper.
-- Behaviorally identical to 20260706000000; only the inlined EXISTS is replaced.
-- ============================================================================

DROP POLICY IF EXISTS "library_field_definitions_insert_policy" ON public.library_field_definitions;
DROP POLICY IF EXISTS "library_field_definitions_update_policy" ON public.library_field_definitions;
DROP POLICY IF EXISTS "library_field_definitions_delete_policy" ON public.library_field_definitions;

CREATE POLICY "library_field_definitions_insert_policy"
  ON public.library_field_definitions FOR INSERT
  WITH CHECK (
    library_id IN (
      SELECT l.id
      FROM public.libraries l
      WHERE public.is_project_owner(l.project_id, auth.uid())
         OR public.is_editor_or_admin_collaborator(l.project_id, auth.uid())
    )
  );

CREATE POLICY "library_field_definitions_update_policy"
  ON public.library_field_definitions FOR UPDATE
  USING (
    library_id IN (
      SELECT l.id
      FROM public.libraries l
      WHERE public.is_project_owner(l.project_id, auth.uid())
         OR public.is_editor_or_admin_collaborator(l.project_id, auth.uid())
    )
  )
  WITH CHECK (
    library_id IN (
      SELECT l.id
      FROM public.libraries l
      WHERE public.is_project_owner(l.project_id, auth.uid())
         OR public.is_editor_or_admin_collaborator(l.project_id, auth.uid())
    )
  );

CREATE POLICY "library_field_definitions_delete_policy"
  ON public.library_field_definitions FOR DELETE
  USING (
    library_id IN (
      SELECT l.id
      FROM public.libraries l
      WHERE public.is_project_owner(l.project_id, auth.uid())
         OR public.is_editor_or_admin_collaborator(l.project_id, auth.uid())
    )
  );

COMMENT ON POLICY "library_field_definitions_insert_policy" ON public.library_field_definitions IS
  'Allow project owners and admin/editor collaborators to insert field definitions';
COMMENT ON POLICY "library_field_definitions_update_policy" ON public.library_field_definitions IS
  'Allow project owners and admin/editor collaborators to update field definitions';
COMMENT ON POLICY "library_field_definitions_delete_policy" ON public.library_field_definitions IS
  'Allow project owners and admin/editor collaborators to delete field definitions';

-- ============================================================================
-- Rebuild projects_update_policy using the helper. Behaviorally identical to
-- 20260706010000; owner_id immutability stays enforced by the existing
-- projects_prevent_owner_reassignment trigger (left untouched here).
-- ============================================================================

DROP POLICY IF EXISTS projects_update_policy ON public.projects;

CREATE POLICY "projects_update_policy"
  ON public.projects FOR UPDATE
  USING (public.is_editor_or_admin_collaborator(id, auth.uid()))
  WITH CHECK (public.is_editor_or_admin_collaborator(id, auth.uid()));

COMMENT ON POLICY "projects_update_policy" ON public.projects IS
  'Admin/editor collaborators can update project metadata; owner_id immutability is enforced by the projects_prevent_owner_reassignment trigger';
