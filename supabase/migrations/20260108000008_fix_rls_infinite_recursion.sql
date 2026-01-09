-- Migration: Fix infinite recursion in RLS policies
-- Problem: is_project_owner() function still triggers RLS on projects table,
--          causing circular dependency with project_collaborators
-- Solution: Make helper functions bypass RLS completely

-- ============================================================================
-- Drop policies first (they depend on the functions)
-- ============================================================================

DROP POLICY IF EXISTS "collaborators_select_policy" ON public.project_collaborators;
DROP POLICY IF EXISTS "projects_select_policy" ON public.projects;

-- ============================================================================
-- Drop and recreate is_project_owner with proper RLS bypass
-- ============================================================================

DROP FUNCTION IF EXISTS public.is_project_owner(UUID, UUID);

-- This function bypasses RLS by using SECURITY DEFINER without triggering policies
CREATE OR REPLACE FUNCTION public.is_project_owner(p_project_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_is_owner BOOLEAN;
BEGIN
  -- Direct query without RLS checks (SECURITY DEFINER bypasses RLS when properly set)
  SELECT EXISTS (
    SELECT 1 FROM public.projects 
    WHERE id = p_project_id AND owner_id = p_user_id
  ) INTO v_is_owner;
  
  RETURN v_is_owner;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_project_owner(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.is_project_owner(UUID, UUID) IS 
  'Check if user is project owner. Uses SECURITY DEFINER to bypass RLS and prevent recursion.';

-- ============================================================================
-- Create helper function to check if user is accepted collaborator
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_accepted_collaborator(p_project_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_is_collaborator BOOLEAN;
BEGIN
  -- Direct query without RLS checks
  SELECT EXISTS (
    SELECT 1 FROM public.project_collaborators 
    WHERE project_id = p_project_id 
      AND user_id = p_user_id 
      AND accepted_at IS NOT NULL
  ) INTO v_is_collaborator;
  
  RETURN v_is_collaborator;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_accepted_collaborator(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.is_accepted_collaborator(UUID, UUID) IS 
  'Check if user is an accepted collaborator. Uses SECURITY DEFINER to bypass RLS and prevent recursion.';

-- ============================================================================
-- Recreate project_collaborators SELECT policy with clearer logic
-- ============================================================================

DROP POLICY IF EXISTS "collaborators_select_policy" ON public.project_collaborators;

CREATE POLICY "collaborators_select_policy"
  ON public.project_collaborators FOR SELECT
  USING (
    -- User can see their own collaborator record
    user_id = auth.uid()
    OR
    -- User is the project owner (bypasses RLS via SECURITY DEFINER)
    public.is_project_owner(project_id, auth.uid())
    OR
    -- User is an accepted collaborator on this project (bypasses RLS via SECURITY DEFINER)
    public.is_accepted_collaborator(project_id, auth.uid())
  );

-- ============================================================================
-- Ensure projects SELECT policy is correct
-- ============================================================================

-- Verify the projects policy uses the correct structure
DROP POLICY IF EXISTS "projects_select_policy" ON public.projects;

CREATE POLICY "projects_select_policy"
  ON public.projects FOR SELECT
  USING (
    -- Owner can always see
    owner_id = auth.uid() 
    OR
    -- Collaborators with accepted invitations can see
    id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

COMMENT ON POLICY "projects_select_policy" ON public.projects IS 
  'Allow project owners and accepted collaborators to view projects. Collaborators table uses SECURITY DEFINER to prevent circular dependency.';

COMMENT ON POLICY "collaborators_select_policy" ON public.project_collaborators IS 
  'Project owners and collaborators can view all collaborators. Uses SECURITY DEFINER to avoid recursion.';

