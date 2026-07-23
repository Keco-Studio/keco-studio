CREATE OR REPLACE FUNCTION public.bind_oauth_project_grant_session()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project_id UUID;
  v_session_ids UUID[];
BEGIN
  IF OLD.status <> 'approved' OR OLD.resource IS NULL THEN
    RETURN OLD;
  END IF;

  IF OLD.resource !~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?/functions/v1/mcp/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN
    RETURN OLD;
  END IF;

  BEGIN
    v_project_id := pg_catalog.regexp_replace(OLD.resource, '^.*/', '')::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN OLD;
  END;

  IF v_project_id IS NULL OR NOT (
    EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = v_project_id
        AND project.owner_id = OLD.user_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.project_collaborators AS collaborator
      WHERE collaborator.project_id = v_project_id
        AND collaborator.user_id = OLD.user_id
        AND collaborator.accepted_at IS NOT NULL
    )
  ) THEN
    RETURN OLD;
  END IF;

  SELECT array_agg(session_row.id ORDER BY session_row.id)
  INTO v_session_ids
  FROM auth.sessions AS session_row
  WHERE session_row.user_id = OLD.user_id
    AND session_row.oauth_client_id = OLD.client_id
    AND session_row.xmin::TEXT::BIGINT = pg_current_xact_id()::TEXT::BIGINT;

  IF cardinality(v_session_ids) = 1 THEN
    INSERT INTO public.oauth_project_grants AS grant_row (
      authorization_id,
      user_id,
      client_id,
      project_id,
      resource,
      session_id,
      prepared_at,
      approved_at,
      exchanged_at
    ) VALUES (
      OLD.authorization_id,
      OLD.user_id,
      OLD.client_id,
      v_project_id,
      OLD.resource,
      v_session_ids[1],
      pg_catalog.clock_timestamp(),
      COALESCE(OLD.approved_at, pg_catalog.clock_timestamp()),
      pg_catalog.clock_timestamp()
    )
    ON CONFLICT (authorization_id) DO UPDATE
    SET
      user_id = EXCLUDED.user_id,
      client_id = EXCLUDED.client_id,
      project_id = EXCLUDED.project_id,
      resource = EXCLUDED.resource,
      session_id = EXCLUDED.session_id,
      prepared_at = EXCLUDED.prepared_at,
      approved_at = EXCLUDED.approved_at,
      exchanged_at = EXCLUDED.exchanged_at;
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.bind_oauth_project_grant_session() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bind_oauth_project_grant_session() FROM anon;
REVOKE ALL ON FUNCTION public.bind_oauth_project_grant_session() FROM authenticated;
REVOKE ALL ON FUNCTION public.bind_oauth_project_grant_session() FROM service_role;
