-- Migration: Fix circular dependency between projects and project_collaborators RLS
-- Problem: projects SELECT policy checks project_collaborators, 
--          which in turn checks projects.owner_id, creating infinite recursion
-- Solution: Simplify policies to break the circular dependency

-- ============================================================================
-- Fix project_collaborators SELECT policy
-- ============================================================================

DROP POLICY IF EXISTS "collaborators_select_policy" ON public.project_collaborators;

-- New policy: Allow users to see their own collaborator records + records in projects they own
-- Uses direct checks without cross-table subqueries
CREATE POLICY "collaborators_select_policy"
  ON public.project_collaborators FOR SELECT
  USING (
    -- User can see their own collaborator record
    user_id = auth.uid()
    OR
    -- For security, we allow viewing all collaborators if user has ANY accepted collaboration
    -- The application layer (Server Actions) will filter by project
    -- This breaks the circular dependency
    EXISTS (
      SELECT 1 FROM public.project_collaborators pc_check
      WHERE pc_check.user_id = auth.uid() 
        AND pc_check.project_id = project_collaborators.project_id
        AND pc_check.accepted_at IS NOT NULL
    )
  );

-- ============================================================================
-- Alternative: Use a helper function with SECURITY DEFINER
-- ============================================================================

-- Create helper function to check if user is project owner
CREATE OR REPLACE FUNCTION public.is_project_owner(p_project_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects 
    WHERE id = p_project_id AND owner_id = p_user_id
  );
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.is_project_owner(UUID, UUID) TO authenticated;

-- Update collaborators SELECT policy to use helper function
DROP POLICY IF EXISTS "collaborators_select_policy" ON public.project_collaborators;

CREATE POLICY "collaborators_select_policy"
  ON public.project_collaborators FOR SELECT
  USING (
    -- User can see their own collaborator record
    user_id = auth.uid()
    OR
    -- User is the project owner (uses SECURITY DEFINER function to avoid recursion)
    public.is_project_owner(project_id, auth.uid())
    OR
    -- User is an accepted collaborator on this project
    EXISTS (
      SELECT 1 FROM public.project_collaborators pc
      WHERE pc.project_id = project_collaborators.project_id
        AND pc.user_id = auth.uid()
        AND pc.accepted_at IS NOT NULL
    )
  );

-- ============================================================================
-- Verify projects SELECT policy doesn't cause recursion
-- ============================================================================

-- The projects SELECT policy is OK as-is because:
-- 1. It checks owner_id = auth.uid() (no recursion)
-- 2. It checks project_collaborators, which now uses SECURITY DEFINER to check projects
--    This breaks the recursion cycle

-- Comment for clarity
COMMENT ON POLICY "projects_select_policy" ON public.projects IS 
  'Allow project owners and accepted collaborators to view projects. Uses SECURITY DEFINER function in collaborators table to avoid circular dependency.';

COMMENT ON FUNCTION public.is_project_owner(UUID, UUID) IS 
  'SECURITY DEFINER helper to check project ownership without triggering RLS recursion';

