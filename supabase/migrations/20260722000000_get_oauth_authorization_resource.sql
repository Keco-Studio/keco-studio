CREATE OR REPLACE FUNCTION public.get_oauth_authorization_resource(
  p_authorization_id TEXT
)
RETURNS TEXT
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT oa.resource
  FROM auth.oauth_authorizations AS oa
  WHERE auth.uid() IS NOT NULL
    AND oa.authorization_id = p_authorization_id
    AND oa.user_id = auth.uid()
    AND oa.status = 'pending'
    AND oa.expires_at > now()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_oauth_authorization_resource(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_oauth_authorization_resource(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.get_oauth_authorization_resource(TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_oauth_authorization_resource(TEXT) TO authenticated;

CREATE TABLE public.oauth_project_grants (
  authorization_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  client_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  resource TEXT NOT NULL CHECK (length(resource) BETWEEN 1 AND 2048),
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);

CREATE INDEX oauth_project_grants_runtime_idx
  ON public.oauth_project_grants (user_id, client_id, project_id, resource);

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
    prepared_at = now(),
    approved_at = NULL
  RETURNING TRUE INTO v_prepared;

  RETURN COALESCE(v_prepared, FALSE);
END;
$$;

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
      AND (
        (
          oa.authorization_id IS NOT NULL
          AND oa.status = 'approved'
          AND oa.user_id = grant_row.user_id
          AND oa.client_id = grant_row.client_id
          AND oa.resource = grant_row.resource
        )
        OR (
          oa.authorization_id IS NULL
        )
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
