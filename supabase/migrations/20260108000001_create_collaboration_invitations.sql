-- Migration: Create collaboration_invitations table
-- Purpose: Track pending and historical invitation records with secure tokens
-- Feature: Real-time Project Collaboration

-- Create the table
CREATE TABLE IF NOT EXISTS public.collaboration_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  invited_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invitation_token TEXT NOT NULL UNIQUE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ DEFAULT NULL,
  accepted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CHECK (accepted_at IS NULL OR accepted_at <= NOW()),
  CHECK (expires_at > sent_at)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_collaboration_invitations_token 
  ON public.collaboration_invitations(invitation_token) 
  WHERE accepted_at IS NULL;
  
CREATE INDEX IF NOT EXISTS idx_collaboration_invitations_email 
  ON public.collaboration_invitations(recipient_email, project_id);
  
CREATE INDEX IF NOT EXISTS idx_collaboration_invitations_project 
  ON public.collaboration_invitations(project_id);

-- Trigger for updated_at
CREATE TRIGGER collaboration_invitations_updated_at
  BEFORE UPDATE ON public.collaboration_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.collaboration_invitations ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- View: Admins can see all invitations for their projects
CREATE POLICY "invitations_select_policy"
  ON public.collaboration_invitations FOR SELECT
  USING (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() 
        AND role = 'admin'
        AND accepted_at IS NOT NULL
    )
  );

-- Insert: Only admins can create invitations
CREATE POLICY "invitations_insert_policy"
  ON public.collaboration_invitations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_collaborators
      WHERE project_id = collaboration_invitations.project_id
        AND user_id = auth.uid()
        AND role = 'admin'
        AND accepted_at IS NOT NULL
    )
  );

-- Update: Only system can update (via Server Action for acceptance)
-- Users don't update directly; Server Action validates and updates
CREATE POLICY "invitations_update_policy"
  ON public.collaboration_invitations FOR UPDATE
  USING (false); -- Block user updates; use service role for acceptance

-- Delete: Admins can revoke pending invitations
CREATE POLICY "invitations_delete_policy"
  ON public.collaboration_invitations FOR DELETE
  USING (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() 
        AND role = 'admin'
        AND accepted_at IS NOT NULL
    )
    AND accepted_at IS NULL -- Can only delete pending invitations
  );

-- Comments
COMMENT ON TABLE public.collaboration_invitations IS 'Tracks invitation lifecycle with JWT tokens for secure acceptance links';
COMMENT ON COLUMN public.collaboration_invitations.invitation_token IS 'JWT token with signature, expires after 7 days';
COMMENT ON COLUMN public.collaboration_invitations.expires_at IS 'Token expiration (7 days from sent_at), enforced on acceptance';
COMMENT ON COLUMN public.collaboration_invitations.accepted_at IS 'NULL = pending, NOT NULL = accepted (one-time use enforced)';

