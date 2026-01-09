-- Migration: Fix RLS recursion in project_collaborators
-- Purpose: Remove circular dependency in RLS policies that causes infinite recursion
-- Issue: Policies were querying project_collaborators while checking permissions on project_collaborators
-- Solution: Use projects table owner_id and direct user_id checks instead

-- Drop existing problematic policies
DROP POLICY IF EXISTS "collaborators_select_policy" ON public.project_collaborators;
DROP POLICY IF EXISTS "collaborators_insert_policy" ON public.project_collaborators;
DROP POLICY IF EXISTS "collaborators_update_policy" ON public.project_collaborators;
DROP POLICY IF EXISTS "collaborators_delete_policy" ON public.project_collaborators;

-- ============================================================================
-- New Policies Without Recursion
-- ============================================================================

-- SELECT: Users can see collaborators for projects they own OR are a collaborator of
-- We check against projects.owner_id to avoid recursion
CREATE POLICY "collaborators_select_policy"
  ON public.project_collaborators FOR SELECT
  USING (
    -- User is the project owner
    project_id IN (
      SELECT id FROM public.projects WHERE owner_id = auth.uid()
    )
    OR
    -- User is a collaborator on this project (direct check, no subquery on same table)
    (user_id = auth.uid() AND accepted_at IS NOT NULL)
    OR
    -- User has an accepted collaboration on this project (check via their own record)
    project_id IN (
      SELECT pc.project_id 
      FROM public.project_collaborators pc
      WHERE pc.user_id = auth.uid() 
        AND pc.accepted_at IS NOT NULL
        AND pc.project_id = project_collaborators.project_id
      LIMIT 1
    )
  );

-- INSERT: Project owners can add collaborators
-- Service role bypasses RLS, so application code can insert after permission check
CREATE POLICY "collaborators_insert_policy"
  ON public.project_collaborators FOR INSERT
  WITH CHECK (
    -- User is the project owner
    project_id IN (
      SELECT id FROM public.projects WHERE owner_id = auth.uid()
    )
  );

-- UPDATE: Project owners can modify collaborator roles
CREATE POLICY "collaborators_update_policy"
  ON public.project_collaborators FOR UPDATE
  USING (
    -- User is the project owner
    project_id IN (
      SELECT id FROM public.projects WHERE owner_id = auth.uid()
    )
  );

-- DELETE: Project owners can remove collaborators
CREATE POLICY "collaborators_delete_policy"
  ON public.project_collaborators FOR DELETE
  USING (
    -- User is the project owner
    project_id IN (
      SELECT id FROM public.projects WHERE owner_id = auth.uid()
    )
  );

-- Comments
COMMENT ON POLICY "collaborators_select_policy" ON public.project_collaborators IS 
  'Project owners and collaborators can view all collaborators. Fixed to avoid recursion.';
  
COMMENT ON POLICY "collaborators_insert_policy" ON public.project_collaborators IS 
  'Only project owners can add collaborators via RLS. Admins use service role in Server Actions.';
  
COMMENT ON POLICY "collaborators_update_policy" ON public.project_collaborators IS 
  'Only project owners can update collaborator roles via RLS. Admins use service role in Server Actions.';
  
COMMENT ON POLICY "collaborators_delete_policy" ON public.project_collaborators IS 
  'Only project owners can remove collaborators via RLS. Admins use service role in Server Actions.';

