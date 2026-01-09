-- Migration: Update RLS policies for collaboration
-- Purpose: Modify existing RLS policies to support role-based collaboration
-- Feature: Real-time Project Collaboration

-- ============================================================================
-- Projects Table - Support Collaborators
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS projects_select_policy ON public.projects;
DROP POLICY IF EXISTS projects_update_policy ON public.projects;
DROP POLICY IF EXISTS projects_delete_policy ON public.projects;

-- New policies supporting collaboration
CREATE POLICY "projects_select_policy"
  ON public.projects FOR SELECT
  USING (
    owner_id = auth.uid() -- Owner can always see
    OR
    id IN ( -- Collaborators with accepted invitations can see
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "projects_update_policy"
  ON public.projects FOR UPDATE
  USING (
    id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() 
        AND role IN ('admin', 'editor') -- Editors can update project metadata
        AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "projects_delete_policy"
  ON public.projects FOR DELETE
  USING (
    owner_id = auth.uid() -- Only owner can delete entire project
  );

-- Insert policy unchanged (owner creates project via create_project_with_default_resource)

-- ============================================================================
-- Libraries Table - Support Collaborators
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS libraries_select_policy ON public.libraries;
DROP POLICY IF EXISTS libraries_insert_policy ON public.libraries;
DROP POLICY IF EXISTS libraries_update_policy ON public.libraries;
DROP POLICY IF EXISTS libraries_delete_policy ON public.libraries;

-- New policies with collaboration support
CREATE POLICY "libraries_select_policy"
  ON public.libraries FOR SELECT
  USING (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "libraries_insert_policy"
  ON public.libraries FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() 
        AND role IN ('admin', 'editor')
        AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "libraries_update_policy"
  ON public.libraries FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() 
        AND role IN ('admin', 'editor')
        AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "libraries_delete_policy"
  ON public.libraries FOR DELETE
  USING (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() 
        AND role IN ('admin', 'editor')
        AND accepted_at IS NOT NULL
    )
  );

-- ============================================================================
-- Library Assets Table - Support Collaborators
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS la_select_auth ON public.library_assets;
DROP POLICY IF EXISTS la_insert_auth ON public.library_assets;
DROP POLICY IF EXISTS la_update_auth ON public.library_assets;
DROP POLICY IF EXISTS la_delete_auth ON public.library_assets;

-- New policies with collaboration support
CREATE POLICY "library_assets_select_policy"
  ON public.library_assets FOR SELECT
  USING (
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() AND pc.accepted_at IS NOT NULL
    )
  );

CREATE POLICY "library_assets_insert_policy"
  ON public.library_assets FOR INSERT
  WITH CHECK (
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() 
        AND pc.role IN ('admin', 'editor')
        AND pc.accepted_at IS NOT NULL
    )
  );

CREATE POLICY "library_assets_update_policy"
  ON public.library_assets FOR UPDATE
  USING (
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() 
        AND pc.role IN ('admin', 'editor')
        AND pc.accepted_at IS NOT NULL
    )
  );

CREATE POLICY "library_assets_delete_policy"
  ON public.library_assets FOR DELETE
  USING (
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() 
        AND pc.role IN ('admin', 'editor')
        AND pc.accepted_at IS NOT NULL
    )
  );

-- ============================================================================
-- Library Asset Values Table - Support Collaborators
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS lav_select_auth ON public.library_asset_values;
DROP POLICY IF EXISTS lav_insert_auth ON public.library_asset_values;
DROP POLICY IF EXISTS lav_update_auth ON public.library_asset_values;
DROP POLICY IF EXISTS lav_delete_auth ON public.library_asset_values;

-- New policies with collaboration support
CREATE POLICY "library_asset_values_select_policy"
  ON public.library_asset_values FOR SELECT
  USING (
    asset_id IN (
      SELECT la.id 
      FROM public.library_assets la
      JOIN public.libraries l ON la.library_id = l.id
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() AND pc.accepted_at IS NOT NULL
    )
  );

CREATE POLICY "library_asset_values_insert_policy"
  ON public.library_asset_values FOR INSERT
  WITH CHECK (
    asset_id IN (
      SELECT la.id 
      FROM public.library_assets la
      JOIN public.libraries l ON la.library_id = l.id
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() 
        AND pc.role IN ('admin', 'editor')
        AND pc.accepted_at IS NOT NULL
    )
  );

CREATE POLICY "library_asset_values_update_policy"
  ON public.library_asset_values FOR UPDATE
  USING (
    asset_id IN (
      SELECT la.id 
      FROM public.library_assets la
      JOIN public.libraries l ON la.library_id = l.id
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() 
        AND pc.role IN ('admin', 'editor')
        AND pc.accepted_at IS NOT NULL
    )
  );

CREATE POLICY "library_asset_values_delete_policy"
  ON public.library_asset_values FOR DELETE
  USING (
    asset_id IN (
      SELECT la.id 
      FROM public.library_assets la
      JOIN public.libraries l ON la.library_id = l.id
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() 
        AND pc.role IN ('admin', 'editor')
        AND pc.accepted_at IS NOT NULL
    )
  );

-- Comments
COMMENT ON POLICY "projects_select_policy" ON public.projects IS 'Allow project owners and accepted collaborators to view projects';
COMMENT ON POLICY "libraries_select_policy" ON public.libraries IS 'Allow all collaborators (admin/editor/viewer) to view libraries';
COMMENT ON POLICY "library_assets_insert_policy" ON public.library_assets IS 'Only admins and editors can create assets (viewers read-only)';

