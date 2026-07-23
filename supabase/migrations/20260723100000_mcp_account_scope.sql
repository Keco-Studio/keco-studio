-- Account-scoped Keco MCP authorization, project discovery, and telemetry.

CREATE TABLE public.oauth_mcp_service_grants (
  authorization_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  client_id UUID NOT NULL,
  resource TEXT NOT NULL CHECK (length(resource) BETWEEN 1 AND 2048),
  session_id UUID NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
  approved_at TIMESTAMPTZ NOT NULL,
  exchanged_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX oauth_mcp_service_grants_runtime_idx
  ON public.oauth_mcp_service_grants (
    session_id,
    user_id,
    client_id,
    resource
  );

CREATE UNIQUE INDEX oauth_mcp_service_grants_session_unique
  ON public.oauth_mcp_service_grants (session_id);

ALTER TABLE public.oauth_mcp_service_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_mcp_service_grants FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.oauth_mcp_service_grants FROM PUBLIC;
REVOKE ALL ON TABLE public.oauth_mcp_service_grants FROM anon;
REVOKE ALL ON TABLE public.oauth_mcp_service_grants FROM authenticated;
REVOKE ALL ON TABLE public.oauth_mcp_service_grants FROM service_role;

CREATE OR REPLACE FUNCTION public.bind_oauth_mcp_service_grant_session()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session_ids UUID[];
BEGIN
  IF OLD.resource IS NULL THEN
    RETURN OLD;
  END IF;

  IF OLD.status <> 'approved'
     OR OLD.resource !~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?/functions/v1/mcp$' THEN
    RETURN OLD;
  END IF;

  SELECT array_agg(s.id ORDER BY s.id)
  INTO v_session_ids
  FROM auth.sessions AS s
  WHERE s.user_id = OLD.user_id
    AND s.oauth_client_id = OLD.client_id
    AND s.xmin::TEXT::BIGINT = pg_current_xact_id()::TEXT::BIGINT;

  IF cardinality(v_session_ids) = 1 THEN
    INSERT INTO public.oauth_mcp_service_grants AS grant_row (
      authorization_id,
      user_id,
      client_id,
      resource,
      session_id,
      approved_at,
      exchanged_at
    ) VALUES (
      OLD.authorization_id,
      OLD.user_id,
      OLD.client_id,
      OLD.resource,
      v_session_ids[1],
      COALESCE(OLD.approved_at, pg_catalog.clock_timestamp()),
      pg_catalog.clock_timestamp()
    )
    ON CONFLICT (authorization_id) DO UPDATE
    SET
      user_id = EXCLUDED.user_id,
      client_id = EXCLUDED.client_id,
      resource = EXCLUDED.resource,
      session_id = EXCLUDED.session_id,
      approved_at = EXCLUDED.approved_at,
      exchanged_at = EXCLUDED.exchanged_at;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS bind_oauth_mcp_service_grant_session_after_exchange
  ON auth.oauth_authorizations;
CREATE TRIGGER bind_oauth_mcp_service_grant_session_after_exchange
AFTER DELETE ON auth.oauth_authorizations
FOR EACH ROW
EXECUTE FUNCTION public.bind_oauth_mcp_service_grant_session();

REVOKE ALL ON FUNCTION public.bind_oauth_mcp_service_grant_session() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bind_oauth_mcp_service_grant_session() FROM anon;
REVOKE ALL ON FUNCTION public.bind_oauth_mcp_service_grant_session() FROM authenticated;
REVOKE ALL ON FUNCTION public.bind_oauth_mcp_service_grant_session() FROM service_role;

CREATE OR REPLACE FUNCTION public.has_oauth_mcp_service_grant(
  p_client_id TEXT,
  p_resource TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
    AND p_client_id IS NOT NULL
    AND p_resource IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.oauth_mcp_service_grants AS grant_row
      JOIN auth.sessions AS session_row
        ON session_row.id = grant_row.session_id
       AND session_row.user_id = grant_row.user_id
       AND session_row.oauth_client_id = grant_row.client_id
      JOIN auth.oauth_consents AS consent
        ON consent.user_id = grant_row.user_id
       AND consent.client_id = grant_row.client_id
       AND consent.revoked_at IS NULL
      LEFT JOIN auth.oauth_authorizations AS authorization_row
        ON authorization_row.authorization_id = grant_row.authorization_id
      WHERE grant_row.user_id = auth.uid()
        AND auth.jwt() ->> 'client_id' = p_client_id
        AND grant_row.client_id::TEXT = p_client_id
        AND grant_row.resource = p_resource
        AND grant_row.session_id::TEXT = auth.jwt() ->> 'session_id'
        AND grant_row.approved_at IS NOT NULL
        AND grant_row.exchanged_at IS NOT NULL
        AND (
          (
            authorization_row.authorization_id IS NOT NULL
            AND authorization_row.status = 'approved'
            AND authorization_row.user_id = grant_row.user_id
            AND authorization_row.client_id = grant_row.client_id
            AND authorization_row.resource = grant_row.resource
          )
          OR authorization_row.authorization_id IS NULL
        )
    );
$$;

REVOKE ALL ON FUNCTION public.has_oauth_mcp_service_grant(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_oauth_mcp_service_grant(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.has_oauth_mcp_service_grant(TEXT, TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.has_oauth_mcp_service_grant(TEXT, TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_resolve_project_role(p_project_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN project.owner_id = auth.uid() THEN 'admin'
    ELSE collaborator.role
  END
  FROM public.projects AS project
  LEFT JOIN public.project_collaborators AS collaborator
    ON collaborator.project_id = project.id
   AND collaborator.user_id = auth.uid()
   AND collaborator.accepted_at IS NOT NULL
  WHERE project.id = p_project_id
    AND auth.uid() IS NOT NULL
    AND (
      project.owner_id = auth.uid()
      OR collaborator.user_id = auth.uid()
    )
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.mcp_resolve_project_role(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mcp_resolve_project_role(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_resolve_project_role(UUID) FROM service_role;
GRANT EXECUTE ON FUNCTION public.mcp_resolve_project_role(UUID) TO authenticated;

CREATE INDEX mcp_projects_owner_created_id_idx
  ON public.projects (owner_id, created_at DESC, id ASC);

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
  WITH access_candidates AS MATERIALIZED (
    SELECT
      project.id AS project_id,
      'admin'::TEXT AS role,
      0 AS role_priority
    FROM public.projects AS project
    WHERE project.owner_id = auth.uid()

    UNION ALL

    SELECT
      collaborator.project_id,
      collaborator.role,
      1 AS role_priority
    FROM public.project_collaborators AS collaborator
    WHERE collaborator.user_id = auth.uid()
      AND collaborator.accepted_at IS NOT NULL
  ), effective_access AS (
    SELECT DISTINCT ON (candidate.project_id)
      candidate.project_id,
      candidate.role
    FROM access_candidates AS candidate
    ORDER BY candidate.project_id, candidate.role_priority
  )
  SELECT
    project.id AS project_id,
    project.name,
    project.description,
    project.created_at,
    access.role
  FROM effective_access AS access
  JOIN public.projects AS project
    ON project.id = access.project_id
  WHERE auth.uid() IS NOT NULL
    AND (
      p_before_created_at IS NULL
      OR project.created_at < p_before_created_at
      OR (project.created_at = p_before_created_at AND project.id > p_after_project_id)
    )
  ORDER BY project.created_at DESC, project.id ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
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

-- Account operations have no project UUID. Keep their rate-limit key separate
-- and record a NULL project_id in the shared append-only audit stream.
CREATE TABLE public.mcp_account_rate_limit_buckets (
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_class TEXT NOT NULL CHECK (
    operation_class IN ('static', 'read', 'write', 'search')
  ),
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (actor_id, operation_class, window_started_at)
);

CREATE INDEX mcp_account_rate_limit_cleanup_idx
  ON public.mcp_account_rate_limit_buckets (window_started_at);

ALTER TABLE public.mcp_account_rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_account_rate_limit_buckets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mcp_account_rate_limit_buckets
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.mcp_audit_events
  ALTER COLUMN project_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.mcp_begin_account_operation(
  p_operation TEXT,
  p_operation_class TEXT,
  p_request_id UUID,
  p_client_id TEXT DEFAULT NULL,
  p_request_bytes INTEGER DEFAULT NULL
)
RETURNS TABLE (
  operation_id UUID,
  remaining INTEGER,
  reset_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_limit INTEGER;
  v_window TIMESTAMPTZ := date_trunc('minute', pg_catalog.clock_timestamp());
  v_count INTEGER;
  v_operation_id UUID := gen_random_uuid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Account access revoked' USING ERRCODE = '42501';
  END IF;

  IF p_operation IS NULL
    OR length(p_operation) NOT BETWEEN 1 AND 100
    OR p_operation !~ '^[a-z][a-z0-9_]*$'
    OR p_request_id IS NULL
    OR p_client_id IS NOT NULL AND length(p_client_id) > 256
    OR p_request_bytes IS NOT NULL
       AND (p_request_bytes < 0 OR p_request_bytes >= 262144) THEN
    RAISE EXCEPTION 'Invalid MCP operation metadata' USING ERRCODE = '22023';
  END IF;

  v_limit := CASE p_operation_class
    WHEN 'static' THEN 240
    WHEN 'read' THEN 120
    WHEN 'write' THEN 30
    WHEN 'search' THEN 20
    ELSE NULL
  END;
  IF v_limit IS NULL THEN
    RAISE EXCEPTION 'Invalid account MCP operation class' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.mcp_account_rate_limit_buckets (
    actor_id,
    operation_class,
    window_started_at,
    request_count
  ) VALUES (
    v_actor,
    p_operation_class,
    v_window,
    1
  )
  ON CONFLICT (actor_id, operation_class, window_started_at)
  DO UPDATE SET
    request_count = public.mcp_account_rate_limit_buckets.request_count + 1,
    updated_at = pg_catalog.clock_timestamp()
  WHERE public.mcp_account_rate_limit_buckets.request_count < v_limit
  RETURNING request_count INTO v_count;

  IF v_count IS NULL THEN
    INSERT INTO public.mcp_audit_events (
      operation_id,
      request_id,
      actor_id,
      project_id,
      client_id,
      event_type,
      operation,
      operation_class,
      outcome,
      error_code,
      request_bytes
    ) VALUES (
      v_operation_id,
      p_request_id,
      v_actor,
      NULL,
      p_client_id,
      'completed',
      p_operation,
      p_operation_class,
      'rate_limited',
      'RATE_LIMITED',
      p_request_bytes
    );
    RETURN QUERY
      SELECT v_operation_id, -1, v_window + interval '1 minute';
    RETURN;
  END IF;

  INSERT INTO public.mcp_audit_events (
    operation_id,
    request_id,
    actor_id,
    project_id,
    client_id,
    event_type,
    operation,
    operation_class,
    outcome,
    request_bytes
  ) VALUES (
    v_operation_id,
    p_request_id,
    v_actor,
    NULL,
    p_client_id,
    'admitted',
    p_operation,
    p_operation_class,
    'admitted',
    p_request_bytes
  );

  RETURN QUERY
    SELECT v_operation_id, v_limit - v_count, v_window + interval '1 minute';
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_begin_account_operation(
  TEXT, TEXT, UUID, TEXT, INTEGER
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mcp_begin_account_operation(
  TEXT, TEXT, UUID, TEXT, INTEGER
) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_begin_account_operation(
  TEXT, TEXT, UUID, TEXT, INTEGER
) FROM service_role;
GRANT EXECUTE ON FUNCTION public.mcp_begin_account_operation(
  TEXT, TEXT, UUID, TEXT, INTEGER
) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_cleanup_telemetry()
RETURNS TABLE (rate_buckets_deleted BIGINT, audit_events_deleted BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_buckets BIGINT;
  v_account_buckets BIGINT;
  v_audit BIGINT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.mcp_rate_limit_buckets
  WHERE window_started_at < pg_catalog.clock_timestamp() - interval '2 days';
  GET DIAGNOSTICS v_buckets = ROW_COUNT;

  DELETE FROM public.mcp_account_rate_limit_buckets
  WHERE window_started_at < pg_catalog.clock_timestamp() - interval '2 days';
  GET DIAGNOSTICS v_account_buckets = ROW_COUNT;

  PERFORM set_config('app.mcp_cleanup', 'on', true);
  DELETE FROM public.mcp_audit_events
  WHERE created_at < pg_catalog.clock_timestamp() - interval '90 days';
  GET DIAGNOSTICS v_audit = ROW_COUNT;

  RETURN QUERY SELECT v_buckets + v_account_buckets, v_audit;
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_cleanup_telemetry()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_cleanup_telemetry() TO service_role;
