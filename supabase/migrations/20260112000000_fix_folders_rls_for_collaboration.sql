-- Migration: Fix folders RLS policies to support collaboration
-- Purpose: Update folders table RLS to allow collaborators to access folders
-- Created: 2026-01-12

-- ============================================================================
-- Folders Table - Support Collaborators
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS folders_select_policy ON public.folders;
DROP POLICY IF EXISTS folders_insert_policy ON public.folders;
DROP POLICY IF EXISTS folders_update_policy ON public.folders;
DROP POLICY IF EXISTS folders_delete_policy ON public.folders;

-- New SELECT policy: Allow project owners and accepted collaborators
CREATE POLICY "folders_select_policy"
  ON public.folders FOR SELECT
  USING (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

-- New INSERT policy: Allow admins and editors to create folders
CREATE POLICY "folders_insert_policy"
  ON public.folders FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() 
        AND role IN ('admin', 'editor')
        AND accepted_at IS NOT NULL
    )
  );

-- New UPDATE policy: Allow admins and editors to update folders
CREATE POLICY "folders_update_policy"
  ON public.folders FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() 
        AND role IN ('admin', 'editor')
        AND accepted_at IS NOT NULL
    )
  );

-- New DELETE policy: Allow admins and editors to delete folders
CREATE POLICY "folders_delete_policy"
  ON public.folders FOR DELETE
  USING (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() 
        AND role IN ('admin', 'editor')
        AND accepted_at IS NOT NULL
    )
  );

-- Comments
COMMENT ON POLICY "folders_select_policy" ON public.folders IS 
  'Allow all collaborators (admin/editor/viewer) to view folders';

COMMENT ON POLICY "folders_insert_policy" ON public.folders IS 
  'Only admins and editors can create folders (viewers read-only)';

COMMENT ON POLICY "folders_update_policy" ON public.folders IS 
  'Only admins and editors can update folders (viewers read-only)';

COMMENT ON POLICY "folders_delete_policy" ON public.folders IS 
  'Only admins and editors can delete folders (viewers read-only)';

