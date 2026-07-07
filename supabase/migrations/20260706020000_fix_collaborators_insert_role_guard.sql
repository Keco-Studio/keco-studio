-- Fix project_collaborators INSERT policy to constrain the granted role (issue #151).
--
-- The prior policy (20260113000000_fix_collaborators_invite_permissions.sql) let
-- any accepted collaborator (including viewers) insert a row with ANY role value,
-- so a low-privileged collaborator calling the table directly could grant
-- themselves or a colluding account the 'admin' role. This scopes the allowed
-- role at the RLS layer:
--   - project owner  -> may grant any role
--   - admin          -> may grant any role
--   - editor         -> may grant only 'editor' or 'viewer'
--   - viewer         -> may not insert collaborators at all
-- The application layer (api/invitations) still performs its own checks.

DROP POLICY IF EXISTS "collaborators_insert_policy" ON public.project_collaborators;

CREATE POLICY "collaborators_insert_policy"
  ON public.project_collaborators FOR INSERT
  WITH CHECK (
    -- Project owner: may grant any role
    project_id IN (
      SELECT id FROM public.projects WHERE owner_id = auth.uid()
    )
    OR
    -- Admin collaborator: may grant any role
    EXISTS (
      SELECT 1 FROM public.project_collaborators pc
      WHERE pc.project_id = project_collaborators.project_id
        AND pc.user_id = auth.uid()
        AND pc.role = 'admin'
        AND pc.accepted_at IS NOT NULL
    )
    OR
    -- Editor collaborator: may grant only editor or viewer (never admin)
    (
      project_collaborators.role IN ('editor', 'viewer')
      AND EXISTS (
        SELECT 1 FROM public.project_collaborators pc
        WHERE pc.project_id = project_collaborators.project_id
          AND pc.user_id = auth.uid()
          AND pc.role = 'editor'
          AND pc.accepted_at IS NOT NULL
      )
    )
  );

COMMENT ON POLICY "collaborators_insert_policy" ON public.project_collaborators IS
  'Owners/admins may grant any role; editors may grant only editor/viewer; viewers cannot invite. Role also enforced at API level.';
