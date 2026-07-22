CREATE TABLE IF NOT EXISTS public.oauth_project_grants (
  authorization_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  client_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  resource TEXT NOT NULL CHECK (length(resource) BETWEEN 1 AND 2048),
  session_id UUID REFERENCES auth.sessions(id) ON DELETE CASCADE,
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  exchanged_at TIMESTAMPTZ
);

ALTER TABLE public.oauth_project_grants
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES auth.sessions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS exchanged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS oauth_project_grants_runtime_idx
  ON public.oauth_project_grants (session_id, user_id, client_id, project_id, resource)
  WHERE session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS oauth_project_grants_session_unique
  ON public.oauth_project_grants (session_id)
  WHERE session_id IS NOT NULL;

ALTER TABLE public.oauth_project_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_project_grants FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.oauth_project_grants FROM PUBLIC;
REVOKE ALL ON TABLE public.oauth_project_grants FROM anon;
REVOKE ALL ON TABLE public.oauth_project_grants FROM authenticated;
REVOKE ALL ON TABLE public.oauth_project_grants FROM service_role;

CREATE OR REPLACE FUNCTION public.prepare_oauth_project_grant(
  p_authorization_id TEXT,
  p_project_id UUID,
  p_resource TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_prepared BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL OR p_authorization_id IS NULL
    OR p_project_id IS NULL OR p_resource IS NULL THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.oauth_project_grants AS grant_row (
    authorization_id,
    user_id,
    client_id,
    project_id,
    resource
  )
  SELECT
    oa.authorization_id,
    oa.user_id,
    oa.client_id,
    p_project_id,
    oa.resource
  FROM auth.oauth_authorizations AS oa
  WHERE oa.authorization_id = p_authorization_id
    AND oa.user_id = v_user_id
    AND oa.status = 'pending'
    AND oa.expires_at > now()
    AND oa.resource = p_resource
    AND (
      EXISTS (
        SELECT 1
        FROM public.projects AS project
        WHERE project.id = p_project_id
          AND project.owner_id = v_user_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.project_collaborators AS collaborator
        WHERE collaborator.project_id = p_project_id
          AND collaborator.user_id = v_user_id
          AND collaborator.accepted_at IS NOT NULL
      )
    )
  ON CONFLICT (authorization_id) DO UPDATE
  SET
    user_id = EXCLUDED.user_id,
    client_id = EXCLUDED.client_id,
    project_id = EXCLUDED.project_id,
    resource = EXCLUDED.resource,
    session_id = NULL,
    prepared_at = now(),
    approved_at = NULL,
    exchanged_at = NULL
  RETURNING TRUE INTO v_prepared;

  RETURN COALESCE(v_prepared, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.bind_oauth_project_grant_session()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session_ids UUID[];
BEGIN
  IF OLD.status <> 'approved' THEN
    RETURN OLD;
  END IF;

  SELECT array_agg(session_row.id ORDER BY session_row.id)
  INTO v_session_ids
  FROM auth.sessions AS session_row
  WHERE session_row.user_id = OLD.user_id
    AND session_row.oauth_client_id = OLD.client_id
    AND session_row.xmin::TEXT::BIGINT = pg_current_xact_id()::TEXT::BIGINT;

  -- Code exchange creates exactly one OAuth session in the transaction that
  -- consumes this authorization. Administrative cleanup creates none.
  IF cardinality(v_session_ids) = 1 THEN
    UPDATE public.oauth_project_grants AS grant_row
    SET
      session_id = v_session_ids[1],
      exchanged_at = pg_catalog.clock_timestamp()
    WHERE grant_row.authorization_id = OLD.authorization_id
      AND grant_row.user_id = OLD.user_id
      AND grant_row.client_id = OLD.client_id
      AND grant_row.resource = OLD.resource
      AND grant_row.approved_at IS NOT NULL
      AND grant_row.session_id IS NULL;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS bind_oauth_project_grant_session_after_exchange
  ON auth.oauth_authorizations;
CREATE TRIGGER bind_oauth_project_grant_session_after_exchange
AFTER DELETE ON auth.oauth_authorizations
FOR EACH ROW
EXECUTE FUNCTION public.bind_oauth_project_grant_session();

CREATE OR REPLACE FUNCTION public.finalize_oauth_project_grant(
  p_authorization_id TEXT,
  p_project_id UUID,
  p_resource TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_finalized BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL OR p_authorization_id IS NULL
    OR p_project_id IS NULL OR p_resource IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE public.oauth_project_grants AS grant_row
  SET approved_at = COALESCE(oa.approved_at, now())
  FROM auth.oauth_authorizations AS oa
  WHERE grant_row.authorization_id = p_authorization_id
    AND grant_row.user_id = auth.uid()
    AND grant_row.project_id = p_project_id
    AND grant_row.resource = p_resource
    AND oa.authorization_id = grant_row.authorization_id
    AND oa.user_id = grant_row.user_id
    AND oa.client_id = grant_row.client_id
    AND oa.resource = grant_row.resource
    AND oa.status = 'approved'
  RETURNING TRUE INTO v_finalized;

  RETURN COALESCE(v_finalized, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.has_oauth_project_grant(
  p_client_id TEXT,
  p_project_id UUID,
  p_resource TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.oauth_project_grants AS grant_row
    JOIN auth.sessions AS session_row
      ON session_row.id = grant_row.session_id
      AND session_row.user_id = grant_row.user_id
      AND session_row.oauth_client_id = grant_row.client_id
    JOIN auth.oauth_consents AS consent
      ON consent.user_id = grant_row.user_id
      AND consent.client_id = grant_row.client_id
      AND consent.revoked_at IS NULL
    LEFT JOIN auth.oauth_authorizations AS oa
      ON oa.authorization_id = grant_row.authorization_id
    WHERE grant_row.user_id = auth.uid()
      AND auth.jwt() ->> 'client_id' = p_client_id
      AND grant_row.client_id::TEXT = p_client_id
      AND grant_row.project_id = p_project_id
      AND grant_row.resource = p_resource
      AND grant_row.approved_at IS NOT NULL
      AND grant_row.exchanged_at IS NOT NULL
      AND grant_row.session_id::TEXT = auth.jwt() ->> 'session_id'
      AND (
        (
          oa.authorization_id IS NOT NULL
          AND oa.status = 'approved'
          AND oa.user_id = grant_row.user_id
          AND oa.client_id = grant_row.client_id
          AND oa.resource = grant_row.resource
        )
        OR oa.authorization_id IS NULL
      )
  );
$$;

REVOKE ALL ON FUNCTION public.prepare_oauth_project_grant(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_oauth_project_grant(TEXT, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.prepare_oauth_project_grant(TEXT, UUID, TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.prepare_oauth_project_grant(TEXT, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.finalize_oauth_project_grant(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_oauth_project_grant(TEXT, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_oauth_project_grant(TEXT, UUID, TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.finalize_oauth_project_grant(TEXT, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.has_oauth_project_grant(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_oauth_project_grant(TEXT, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.has_oauth_project_grant(TEXT, UUID, TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.has_oauth_project_grant(TEXT, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.bind_oauth_project_grant_session() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bind_oauth_project_grant_session() FROM anon;
REVOKE ALL ON FUNCTION public.bind_oauth_project_grant_session() FROM authenticated;
REVOKE ALL ON FUNCTION public.bind_oauth_project_grant_session() FROM service_role;
