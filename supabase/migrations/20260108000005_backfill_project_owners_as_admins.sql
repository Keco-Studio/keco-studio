-- Migration: Backfill project owners as admins
-- Purpose: Automatically create admin collaborator records for existing project owners
-- Feature: Real-time Project Collaboration

-- Backfill project_collaborators for existing projects
-- This ensures all existing project owners have admin access in the new collaboration system
INSERT INTO public.project_collaborators (user_id, project_id, role, invited_by, accepted_at)
SELECT 
  owner_id AS user_id,
  id AS project_id,
  'admin' AS role,
  NULL AS invited_by, -- Self-added (owner)
  created_at AS accepted_at -- Retroactive acceptance timestamp
FROM public.projects
WHERE owner_id IS NOT NULL -- Only process projects with owners
ON CONFLICT (user_id, project_id) DO NOTHING; -- Skip if already exists

-- Comments
COMMENT ON TABLE public.project_collaborators IS 'Existing project owners automatically added as admins during migration for backward compatibility';

