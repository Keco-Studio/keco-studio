-- Fix library_field_definitions RLS to match library_assets access rules.

DROP POLICY IF EXISTS lfd_select_auth ON public.library_field_definitions;
DROP POLICY IF EXISTS lfd_insert_auth ON public.library_field_definitions;
DROP POLICY IF EXISTS lfd_update_auth ON public.library_field_definitions;
DROP POLICY IF EXISTS lfd_delete_auth ON public.library_field_definitions;
DROP POLICY IF EXISTS "library_field_definitions_select_policy" ON public.library_field_definitions;
DROP POLICY IF EXISTS "library_field_definitions_insert_policy" ON public.library_field_definitions;
DROP POLICY IF EXISTS "library_field_definitions_update_policy" ON public.library_field_definitions;
DROP POLICY IF EXISTS "library_field_definitions_delete_policy" ON public.library_field_definitions;

CREATE POLICY "library_field_definitions_select_policy"
  ON public.library_field_definitions FOR SELECT
  USING (
    library_id IN (
      SELECT l.id
      FROM public.libraries l
      WHERE public.is_project_owner(l.project_id, auth.uid())
         OR public.is_accepted_collaborator(l.project_id, auth.uid())
    )
  );

CREATE POLICY "library_field_definitions_insert_policy"
  ON public.library_field_definitions FOR INSERT
  WITH CHECK (
    library_id IN (
      SELECT l.id
      FROM public.libraries l
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

CREATE POLICY "library_field_definitions_update_policy"
  ON public.library_field_definitions FOR UPDATE
  USING (
    library_id IN (
      SELECT l.id
      FROM public.libraries l
      WHERE public.is_project_owner(l.project_id, auth.uid())
         OR EXISTS (
           SELECT 1 FROM public.project_collaborators pc
           WHERE pc.project_id = l.project_id
             AND pc.user_id = auth.uid()
             AND pc.role IN ('admin', 'editor')
             AND pc.accepted_at IS NOT NULL
         )
    )
  )
  WITH CHECK (
    library_id IN (
      SELECT l.id
      FROM public.libraries l
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

CREATE POLICY "library_field_definitions_delete_policy"
  ON public.library_field_definitions FOR DELETE
  USING (
    library_id IN (
      SELECT l.id
      FROM public.libraries l
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

COMMENT ON POLICY "library_field_definitions_select_policy" ON public.library_field_definitions IS
  'Allow project owners and accepted collaborators to read field definitions';
COMMENT ON POLICY "library_field_definitions_insert_policy" ON public.library_field_definitions IS
  'Allow project owners and admin/editor collaborators to insert field definitions';
COMMENT ON POLICY "library_field_definitions_update_policy" ON public.library_field_definitions IS
  'Allow project owners and admin/editor collaborators to update field definitions';
COMMENT ON POLICY "library_field_definitions_delete_policy" ON public.library_field_definitions IS
  'Allow project owners and admin/editor collaborators to delete field definitions';
