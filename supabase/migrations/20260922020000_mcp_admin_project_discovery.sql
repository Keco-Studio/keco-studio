-- Constant-time admin-project discovery for account-scoped MCP tool exposure.

CREATE OR REPLACE FUNCTION public.mcp_has_admin_project()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.projects AS project
        WHERE project.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.project_collaborators AS collaborator
        WHERE collaborator.user_id = auth.uid()
          AND collaborator.accepted_at IS NOT NULL
          AND collaborator.role = 'admin'
      )
    );
$$;

REVOKE ALL ON FUNCTION public.mcp_has_admin_project()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_has_admin_project() TO authenticated;

NOTIFY pgrst, 'reload schema';
