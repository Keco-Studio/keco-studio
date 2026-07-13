-- Reduce per-row RLS overhead without changing authorization semantics.
-- SECURITY DEFINER remains required to avoid the historical projects /
-- project_collaborators policy recursion.

CREATE OR REPLACE FUNCTION public.is_project_owner(p_project_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects
    WHERE id = p_project_id
      AND owner_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_accepted_collaborator(p_project_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_collaborators
    WHERE project_id = p_project_id
      AND user_id = p_user_id
      AND accepted_at IS NOT NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.is_editor_or_admin_collaborator(
  p_project_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_collaborators
    WHERE project_id = p_project_id
      AND user_id = p_user_id
      AND role IN ('admin', 'editor')
      AND accepted_at IS NOT NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_project_owner(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_accepted_collaborator(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_editor_or_admin_collaborator(UUID, UUID) TO authenticated;

DROP POLICY IF EXISTS "library_asset_values_select_policy" ON public.library_asset_values;
DROP POLICY IF EXISTS "library_asset_values_insert_policy" ON public.library_asset_values;
DROP POLICY IF EXISTS "library_asset_values_update_policy" ON public.library_asset_values;
DROP POLICY IF EXISTS "library_asset_values_delete_policy" ON public.library_asset_values;

CREATE POLICY "library_asset_values_select_policy"
  ON public.library_asset_values FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.library_assets la
      JOIN public.libraries l ON l.id = la.library_id
      WHERE la.id = library_asset_values.asset_id
        AND (
          public.is_project_owner(l.project_id, (SELECT auth.uid()))
          OR public.is_accepted_collaborator(l.project_id, (SELECT auth.uid()))
        )
    )
  );

CREATE POLICY "library_asset_values_insert_policy"
  ON public.library_asset_values FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.library_assets la
      JOIN public.libraries l ON l.id = la.library_id
      WHERE la.id = library_asset_values.asset_id
        AND (
          public.is_project_owner(l.project_id, (SELECT auth.uid()))
          OR public.is_editor_or_admin_collaborator(l.project_id, (SELECT auth.uid()))
        )
    )
  );

CREATE POLICY "library_asset_values_update_policy"
  ON public.library_asset_values FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.library_assets la
      JOIN public.libraries l ON l.id = la.library_id
      WHERE la.id = library_asset_values.asset_id
        AND (
          public.is_project_owner(l.project_id, (SELECT auth.uid()))
          OR public.is_editor_or_admin_collaborator(l.project_id, (SELECT auth.uid()))
        )
    )
  );

CREATE POLICY "library_asset_values_delete_policy"
  ON public.library_asset_values FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.library_assets la
      JOIN public.libraries l ON l.id = la.library_id
      WHERE la.id = library_asset_values.asset_id
        AND (
          public.is_project_owner(l.project_id, (SELECT auth.uid()))
          OR public.is_editor_or_admin_collaborator(l.project_id, (SELECT auth.uid()))
        )
    )
  );

DROP POLICY IF EXISTS "library_field_definitions_select_policy" ON public.library_field_definitions;
DROP POLICY IF EXISTS "library_field_definitions_insert_policy" ON public.library_field_definitions;
DROP POLICY IF EXISTS "library_field_definitions_update_policy" ON public.library_field_definitions;
DROP POLICY IF EXISTS "library_field_definitions_delete_policy" ON public.library_field_definitions;

CREATE POLICY "library_field_definitions_select_policy"
  ON public.library_field_definitions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.libraries l
      WHERE l.id = library_field_definitions.library_id
        AND (
          public.is_project_owner(l.project_id, (SELECT auth.uid()))
          OR public.is_accepted_collaborator(l.project_id, (SELECT auth.uid()))
        )
    )
  );

CREATE POLICY "library_field_definitions_insert_policy"
  ON public.library_field_definitions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.libraries l
      WHERE l.id = library_field_definitions.library_id
        AND (
          public.is_project_owner(l.project_id, (SELECT auth.uid()))
          OR public.is_editor_or_admin_collaborator(l.project_id, (SELECT auth.uid()))
        )
    )
  );

CREATE POLICY "library_field_definitions_update_policy"
  ON public.library_field_definitions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.libraries l
      WHERE l.id = library_field_definitions.library_id
        AND (
          public.is_project_owner(l.project_id, (SELECT auth.uid()))
          OR public.is_editor_or_admin_collaborator(l.project_id, (SELECT auth.uid()))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.libraries l
      WHERE l.id = library_field_definitions.library_id
        AND (
          public.is_project_owner(l.project_id, (SELECT auth.uid()))
          OR public.is_editor_or_admin_collaborator(l.project_id, (SELECT auth.uid()))
        )
    )
  );

CREATE POLICY "library_field_definitions_delete_policy"
  ON public.library_field_definitions FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.libraries l
      WHERE l.id = library_field_definitions.library_id
        AND (
          public.is_project_owner(l.project_id, (SELECT auth.uid()))
          OR public.is_editor_or_admin_collaborator(l.project_id, (SELECT auth.uid()))
        )
    )
  );

DROP POLICY IF EXISTS "library_versions_select_policy" ON public.library_versions;
DROP POLICY IF EXISTS "library_versions_insert_policy" ON public.library_versions;
DROP POLICY IF EXISTS "library_versions_update_policy" ON public.library_versions;
DROP POLICY IF EXISTS "library_versions_delete_policy" ON public.library_versions;

CREATE POLICY "library_versions_select_policy"
  ON public.library_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.libraries l
      WHERE l.id = library_versions.library_id
        AND (
          public.is_project_owner(l.project_id, (SELECT auth.uid()))
          OR public.is_accepted_collaborator(l.project_id, (SELECT auth.uid()))
        )
    )
  );

CREATE POLICY "library_versions_insert_policy"
  ON public.library_versions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.libraries l
      WHERE l.id = library_versions.library_id
        AND (
          public.is_project_owner(l.project_id, (SELECT auth.uid()))
          OR public.is_editor_or_admin_collaborator(l.project_id, (SELECT auth.uid()))
        )
    )
  );

CREATE POLICY "library_versions_update_policy"
  ON public.library_versions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.libraries l
      WHERE l.id = library_versions.library_id
        AND (
          public.is_project_owner(l.project_id, (SELECT auth.uid()))
          OR public.is_editor_or_admin_collaborator(l.project_id, (SELECT auth.uid()))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.libraries l
      WHERE l.id = library_versions.library_id
        AND (
          public.is_project_owner(l.project_id, (SELECT auth.uid()))
          OR public.is_editor_or_admin_collaborator(l.project_id, (SELECT auth.uid()))
        )
    )
  );

CREATE POLICY "library_versions_delete_policy"
  ON public.library_versions FOR DELETE
  USING (
    is_current = FALSE
    AND EXISTS (
      SELECT 1
      FROM public.libraries l
      WHERE l.id = library_versions.library_id
        AND (
          public.is_project_owner(l.project_id, (SELECT auth.uid()))
          OR public.is_editor_or_admin_collaborator(l.project_id, (SELECT auth.uid()))
        )
    )
  );

COMMENT ON FUNCTION public.is_project_owner(UUID, UUID) IS
  'Checks project ownership without recursive RLS evaluation.';
COMMENT ON FUNCTION public.is_accepted_collaborator(UUID, UUID) IS
  'Checks accepted collaboration without recursive RLS evaluation.';
COMMENT ON FUNCTION public.is_editor_or_admin_collaborator(UUID, UUID) IS
  'Checks accepted editor/admin access without recursive RLS evaluation.';
