-- Migration: Extend invitation expiration to 1 year
-- Purpose: Make invitations valid for longer period
-- Date: 2026-01-16

-- Update the default for new invitations to 365 days (1 year)
ALTER TABLE public.collaboration_invitations 
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '365 days');

-- Update existing pending invitations to extend their expiration to 1 year from now
-- (Only update invitations that haven't been accepted yet)
UPDATE public.collaboration_invitations
SET expires_at = NOW() + INTERVAL '365 days'
WHERE accepted_at IS NULL;

-- Update comments to reflect new expiration period
COMMENT ON COLUMN public.collaboration_invitations.invitation_token IS 'JWT token with signature, expires after 365 days (1 year)';
COMMENT ON COLUMN public.collaboration_invitations.expires_at IS 'Token expiration (365 days from sent_at), enforced on acceptance';

