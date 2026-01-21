-- Migration: Fix collaborator UPDATE and DELETE permissions for admin role
-- Created: 2026-01-20
-- Purpose: Allow admin role collaborators to update and delete collaborators
-- 
-- Current Issue: Only project owners can update/delete collaborators (via RLS)
-- Solution: Update UPDATE and DELETE policies to allow admin role collaborators
--
-- This aligns with the INSERT policy fix from 20260113000000_fix_collaborators_invite_permissions.sql
-- and matches the backend API permissions that already allow admins to manage collaborators.

-- ============================================================================
-- Drop existing UPDATE and DELETE policies
-- ============================================================================

DROP POLICY IF EXISTS "collaborators_update_policy" ON public.project_collaborators;
DROP POLICY IF EXISTS "collaborators_delete_policy" ON public.project_collaborators;

-- ============================================================================
-- Create new UPDATE policy that allows project owners and admin collaborators
-- ============================================================================

CREATE POLICY "collaborators_update_policy"
  ON public.project_collaborators FOR UPDATE
  USING (
    -- User is the project owner
    project_id IN (
      SELECT id FROM public.projects WHERE owner_id = auth.uid()
    )
    OR
    -- User is an admin collaborator
    EXISTS (
      SELECT 1 FROM public.project_collaborators pc
      WHERE pc.project_id = project_collaborators.project_id
        AND pc.user_id = auth.uid()
        AND pc.role = 'admin'
        AND pc.accepted_at IS NOT NULL
    )
  );

-- ============================================================================
-- Create new DELETE policy that allows project owners and admin collaborators
-- ============================================================================

CREATE POLICY "collaborators_delete_policy"
  ON public.project_collaborators FOR DELETE
  USING (
    -- User is the project owner
    project_id IN (
      SELECT id FROM public.projects WHERE owner_id = auth.uid()
    )
    OR
    -- User is an admin collaborator
    EXISTS (
      SELECT 1 FROM public.project_collaborators pc
      WHERE pc.project_id = project_collaborators.project_id
        AND pc.user_id = auth.uid()
        AND pc.role = 'admin'
        AND pc.accepted_at IS NOT NULL
    )
  );

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON POLICY "collaborators_update_policy" ON public.project_collaborators IS 
  'Project owners and admin collaborators can update collaborator roles. Additional validation (e.g., preventing self-role-change, ensuring at least one admin) is enforced at API level.';

COMMENT ON POLICY "collaborators_delete_policy" ON public.project_collaborators IS 
  'Project owners and admin collaborators can remove collaborators. Additional validation (e.g., preventing self-removal, ensuring at least one admin) is enforced at API level.';

