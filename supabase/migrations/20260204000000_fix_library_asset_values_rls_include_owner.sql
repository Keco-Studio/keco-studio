-- Migration: Fix library_asset_values RLS to include project owners
-- Problem: RLS policies only check project_collaborators; project owners who are
--          not in project_collaborators (e.g. pre-migration projects) get 42501.
-- Solution: Add is_project_owner() OR condition to all library_asset_values policies.

-- ============================================================================
-- Drop and recreate library_asset_values policies with owner support
-- ============================================================================

DROP POLICY IF EXISTS "library_asset_values_select_policy" ON public.library_asset_values;
DROP POLICY IF EXISTS "library_asset_values_insert_policy" ON public.library_asset_values;
DROP POLICY IF EXISTS "library_asset_values_update_policy" ON public.library_asset_values;
DROP POLICY IF EXISTS "library_asset_values_delete_policy" ON public.library_asset_values;

-- SELECT: project owner OR accepted collaborator (any role for read)
CREATE POLICY "library_asset_values_select_policy"
  ON public.library_asset_values FOR SELECT
  USING (
    asset_id IN (
      SELECT la.id 
      FROM public.library_assets la
      JOIN public.libraries l ON la.library_id = l.id
      WHERE public.is_project_owner(l.project_id, auth.uid())
         OR EXISTS (
           SELECT 1 FROM public.project_collaborators pc
           WHERE pc.project_id = l.project_id
             AND pc.user_id = auth.uid()
             AND pc.accepted_at IS NOT NULL
         )
    )
  );

-- INSERT: project owner OR admin/editor collaborator
CREATE POLICY "library_asset_values_insert_policy"
  ON public.library_asset_values FOR INSERT
  WITH CHECK (
    asset_id IN (
      SELECT la.id 
      FROM public.library_assets la
      JOIN public.libraries l ON la.library_id = l.id
      WHERE public.is_project_owner(l.project_id, auth.uid())
         OR EXISTS (
           SELECT 1 FROM public.project_collaborators pc
           WHERE pc.project_id = l.project_id
             AND pc.user_id = auth.uid()
             AND pc.role IN ('admin', 'editor')
             AND pc.accepted_at IS NOT NULL
         )
    )
  );

-- UPDATE: project owner OR admin/editor collaborator
CREATE POLICY "library_asset_values_update_policy"
  ON public.library_asset_values FOR UPDATE
  USING (
    asset_id IN (
      SELECT la.id 
      FROM public.library_assets la
      JOIN public.libraries l ON la.library_id = l.id
      WHERE public.is_project_owner(l.project_id, auth.uid())
         OR EXISTS (
           SELECT 1 FROM public.project_collaborators pc
           WHERE pc.project_id = l.project_id
             AND pc.user_id = auth.uid()
             AND pc.role IN ('admin', 'editor')
             AND pc.accepted_at IS NOT NULL
         )
    )
  );

-- DELETE: project owner OR admin/editor collaborator
CREATE POLICY "library_asset_values_delete_policy"
  ON public.library_asset_values FOR DELETE
  USING (
    asset_id IN (
      SELECT la.id 
      FROM public.library_assets la
      JOIN public.libraries l ON la.library_id = l.id
      WHERE public.is_project_owner(l.project_id, auth.uid())
         OR EXISTS (
           SELECT 1 FROM public.project_collaborators pc
           WHERE pc.project_id = l.project_id
             AND pc.user_id = auth.uid()
             AND pc.role IN ('admin', 'editor')
             AND pc.accepted_at IS NOT NULL
         )
    )
  );

COMMENT ON POLICY "library_asset_values_select_policy" ON public.library_asset_values IS 
  'Allow project owners and accepted collaborators to read asset values';
COMMENT ON POLICY "library_asset_values_insert_policy" ON public.library_asset_values IS 
  'Allow project owners and admin/editor collaborators to insert asset values (fixes batch fill RLS 42501)';
COMMENT ON POLICY "library_asset_values_update_policy" ON public.library_asset_values IS 
  'Allow project owners and admin/editor collaborators to update asset values';
COMMENT ON POLICY "library_asset_values_delete_policy" ON public.library_asset_values IS 
  'Allow project owners and admin/editor collaborators to delete asset values';
