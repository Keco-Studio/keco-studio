-- Migration: Fix collaborator invite permissions for admin and editor roles
-- Created: 2026-01-13
-- Purpose: Allow admin and editor roles to invite new collaborators
-- 
-- Current Issue: Only project owners can add collaborators
-- Solution: Update INSERT policy to allow admin and editor roles to add collaborators
--
-- Permission Rules (from requirements):
-- - admin: can invite as admin, editor, or viewer
-- - editor: can invite as editor or viewer (NOT admin)
-- - viewer: can only invite as viewer
-- - All invitations are checked at application level (API route)

-- ============================================================================
-- Drop existing INSERT policy
-- ============================================================================

DROP POLICY IF EXISTS "collaborators_insert_policy" ON public.project_collaborators;

-- ============================================================================
-- Create new INSERT policy that allows admin and editor to add collaborators
-- ============================================================================

CREATE POLICY "collaborators_insert_policy"
  ON public.project_collaborators FOR INSERT
  WITH CHECK (
    -- User is the project owner
    project_id IN (
      SELECT id FROM public.projects WHERE owner_id = auth.uid()
    )
    OR
    -- User is an admin collaborator (can invite anyone)
    EXISTS (
      SELECT 1 FROM public.project_collaborators pc
      WHERE pc.project_id = project_collaborators.project_id
        AND pc.user_id = auth.uid()
        AND pc.role = 'admin'
        AND pc.accepted_at IS NOT NULL
    )
    OR
    -- User is an editor collaborator (application layer checks invited role)
    EXISTS (
      SELECT 1 FROM public.project_collaborators pc
      WHERE pc.project_id = project_collaborators.project_id
        AND pc.user_id = auth.uid()
        AND pc.role = 'editor'
        AND pc.accepted_at IS NOT NULL
    )
    OR
    -- User is a viewer collaborator (application layer checks invited role)
    EXISTS (
      SELECT 1 FROM public.project_collaborators pc
      WHERE pc.project_id = project_collaborators.project_id
        AND pc.user_id = auth.uid()
        AND pc.role = 'viewer'
        AND pc.accepted_at IS NOT NULL
    )
  );

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON POLICY "collaborators_insert_policy" ON public.project_collaborators IS 
  'Project owners, admins, editors, and viewers can add collaborators. Role restrictions enforced at API level:
   - admin: can invite as admin/editor/viewer
   - editor: can invite as editor/viewer
   - viewer: can invite as viewer only';

