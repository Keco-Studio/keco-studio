-- Constant-time writable-project discovery for account-scoped MCP tools.

CREATE OR REPLACE FUNCTION public.mcp_has_writable_project()
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
          AND collaborator.role IN ('admin', 'editor')
      )
    );
$$;

REVOKE ALL ON FUNCTION public.mcp_has_writable_project() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mcp_has_writable_project() FROM anon;
REVOKE ALL ON FUNCTION public.mcp_has_writable_project() FROM service_role;
GRANT EXECUTE ON FUNCTION public.mcp_has_writable_project() TO authenticated;

CREATE INDEX mcp_writable_project_collaborators_user_idx
  ON public.project_collaborators (user_id)
  WHERE accepted_at IS NOT NULL
    AND role IN ('admin', 'editor');

-- Each source branch is independently limited before they are merged. The
-- bounded merge retains every possible global first-page ID before owner-priority
-- deduplication and project metadata lookup.
CREATE INDEX mcp_projects_owner_id_idx
  ON public.projects (owner_id, id);

CREATE INDEX mcp_accepted_project_collaborators_user_project_idx
  ON public.project_collaborators (user_id, project_id) INCLUDE (role)
  WHERE accepted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mcp_list_accessible_projects(
  p_limit INTEGER DEFAULT 50,
  p_before_created_at TIMESTAMPTZ DEFAULT NULL,
  p_after_project_id UUID DEFAULT NULL
)
RETURNS TABLE (
  project_id UUID,
  name TEXT,
  description TEXT,
  created_at TIMESTAMPTZ,
  role TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- p_before_created_at remains for RPC signature compatibility. Account MCP
  -- cursors now keyset only on project_id, avoiding an unbounded created_at sort.
  WITH page_bounds AS (
    SELECT GREATEST(1, LEAST(COALESCE(p_limit, 50), 101)) AS page_limit
  ), owned_projects AS (
    SELECT
      project.id AS project_id,
      'admin'::TEXT AS role,
      0 AS role_priority
    FROM public.projects AS project
    WHERE auth.uid() IS NOT NULL
      AND project.owner_id = auth.uid()
      AND project.id > COALESCE(
        p_after_project_id,
        '00000000-0000-0000-0000-000000000000'::UUID
      )
    ORDER BY project.id ASC
    LIMIT (SELECT page_limit FROM page_bounds)
  ), collaborator_projects AS (
    SELECT
      collaborator.project_id,
      collaborator.role,
      1 AS role_priority
    FROM public.project_collaborators AS collaborator
    WHERE auth.uid() IS NOT NULL
      AND collaborator.user_id = auth.uid()
      AND collaborator.accepted_at IS NOT NULL
      AND collaborator.project_id > COALESCE(
        p_after_project_id,
        '00000000-0000-0000-0000-000000000000'::UUID
      )
    ORDER BY collaborator.project_id ASC
    LIMIT (SELECT page_limit FROM page_bounds)
  ), access_candidates AS (
    SELECT * FROM owned_projects
    UNION ALL
    SELECT * FROM collaborator_projects
  ), effective_access AS (
    SELECT DISTINCT ON (candidate.project_id)
      candidate.project_id,
      candidate.role
    FROM access_candidates AS candidate
    ORDER BY candidate.project_id, candidate.role_priority
  )
  SELECT
    access.project_id,
    project.name,
    project.description,
    project.created_at,
    access.role
  FROM effective_access AS access
  JOIN public.projects AS project ON project.id = access.project_id
  ORDER BY access.project_id ASC
  LIMIT (SELECT page_limit FROM page_bounds);
$$;

REVOKE ALL ON FUNCTION public.mcp_list_accessible_projects(
  INTEGER, TIMESTAMPTZ, UUID
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mcp_list_accessible_projects(
  INTEGER, TIMESTAMPTZ, UUID
) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_list_accessible_projects(
  INTEGER, TIMESTAMPTZ, UUID
) FROM service_role;
GRANT EXECUTE ON FUNCTION public.mcp_list_accessible_projects(
  INTEGER, TIMESTAMPTZ, UUID
) TO authenticated;
