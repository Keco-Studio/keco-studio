-- Shorten invitation expiration back to 7 days (issue #156, item 3).
--
-- 20260116000001_extend_invitation_expiration.sql set both the JWT lifetime and
-- the DB expires_at default to 365 days. Invitation links are unauthenticated
-- bearer tokens (e.g. /api/invitations/decline), so a year-long validity window
-- is a large exposure. Align the DB default with the 7-day token default and
-- pull in any still-pending invitations that were issued with the long window.

ALTER TABLE public.collaboration_invitations
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '7 days');

-- Clamp existing pending invitations that were granted the 365-day window so
-- they cannot outlive the new policy. Only shorten (never extend) and only for
-- invitations that have not been accepted yet.
UPDATE public.collaboration_invitations
SET expires_at = LEAST(expires_at, NOW() + INTERVAL '7 days')
WHERE accepted_at IS NULL;

COMMENT ON COLUMN public.collaboration_invitations.invitation_token IS 'JWT token with signature, expires after 7 days';
COMMENT ON COLUMN public.collaboration_invitations.expires_at IS 'Token expiration (7 days from sent_at), enforced on acceptance';
