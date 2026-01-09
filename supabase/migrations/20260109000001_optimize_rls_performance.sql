-- Migration: Optimize RLS Policy Performance with Indexes
-- Created: 2026-01-09
-- Purpose: Add database indexes to improve RLS policy query performance

-- ============================================================================
-- Project Collaborators Indexes
-- ============================================================================

-- Index for RLS policy permission checks (most frequent query pattern)
-- Used in: projects, libraries, library_assets RLS policies
CREATE INDEX IF NOT EXISTS idx_project_collaborators_permission_check
  ON public.project_collaborators(user_id, project_id, role, accepted_at)
  WHERE accepted_at IS NOT NULL;

-- Index for project-scoped collaborator lookups
CREATE INDEX IF NOT EXISTS idx_project_collaborators_project_active
  ON public.project_collaborators(project_id)
  WHERE accepted_at IS NOT NULL;

-- Index for user-scoped project lookups
CREATE INDEX IF NOT EXISTS idx_project_collaborators_user_active
  ON public.project_collaborators(user_id)
  WHERE accepted_at IS NOT NULL;

-- ============================================================================
-- Collaboration Invitations Indexes
-- ============================================================================

-- Index for pending invitation lookups by email
-- Note: We don't filter by expires_at in the index because NOW() is not IMMUTABLE
-- The query will still filter expired invitations at runtime
CREATE INDEX IF NOT EXISTS idx_collaboration_invitations_pending_email
  ON public.collaboration_invitations(recipient_email, project_id)
  WHERE accepted_at IS NULL;

-- Index for token validation (invitation acceptance)
CREATE INDEX IF NOT EXISTS idx_collaboration_invitations_token_pending
  ON public.collaboration_invitations(invitation_token)
  WHERE accepted_at IS NULL;

-- ============================================================================
-- Libraries Indexes (for RLS with collaborators)
-- ============================================================================

-- Index for library access via project collaborators
CREATE INDEX IF NOT EXISTS idx_libraries_project_id
  ON public.libraries(project_id);

-- ============================================================================
-- Library Assets Indexes (for RLS with collaborators)
-- ============================================================================

-- Composite index for asset access checks
CREATE INDEX IF NOT EXISTS idx_library_assets_library_id
  ON public.library_assets(library_id);

-- ============================================================================
-- Profiles Indexes (for collaborator lookups)
-- ============================================================================

-- Index for email lookups (used in invitation validation)
CREATE INDEX IF NOT EXISTS idx_profiles_email_lower
  ON public.profiles(LOWER(email));

-- ============================================================================
-- Performance Analysis
-- ============================================================================

-- Analyze tables to update statistics after index creation
ANALYZE public.project_collaborators;
ANALYZE public.collaboration_invitations;
ANALYZE public.libraries;
ANALYZE public.library_assets;
ANALYZE public.profiles;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON INDEX idx_project_collaborators_permission_check IS 
  'Optimizes RLS policy permission checks - most critical performance index';

COMMENT ON INDEX idx_collaboration_invitations_pending_email IS 
  'Speeds up duplicate invitation detection';

COMMENT ON INDEX idx_profiles_email_lower IS 
  'Enables case-insensitive email lookups for invitation validation';

