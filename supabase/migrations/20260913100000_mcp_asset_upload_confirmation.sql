CREATE TABLE IF NOT EXISTS public.mcp_asset_upload_preferences (
  session_id UUID NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  client_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  asset_upload_auto_execute BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, project_id)
);
ALTER TABLE public.mcp_asset_upload_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_asset_upload_preferences FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mcp_asset_upload_preferences FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.mcp_get_asset_upload_auto_execute(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session_id UUID;
  v_client_id UUID;
  v_user_id UUID := auth.uid();
  v_value BOOLEAN;
BEGIN
  IF v_user_id IS NULL OR p_project_id IS NULL OR NOT (
    EXISTS (
      SELECT 1 FROM public.projects AS project
      WHERE project.id = p_project_id AND project.owner_id = v_user_id
    ) OR EXISTS (
      SELECT 1 FROM public.project_collaborators AS collaborator
      WHERE collaborator.project_id = p_project_id
        AND collaborator.user_id = v_user_id
        AND collaborator.accepted_at IS NOT NULL
        AND collaborator.role IN ('admin', 'editor')
    )
  ) THEN RETURN NULL; END IF;
  v_session_id := CASE WHEN auth.jwt() ->> 'session_id' ~* '^[0-9a-f-]{36}$'
    THEN (auth.jwt() ->> 'session_id')::UUID END;
  v_client_id := CASE WHEN auth.jwt() ->> 'client_id' ~* '^[0-9a-f-]{36}$'
    THEN (auth.jwt() ->> 'client_id')::UUID END;
  IF v_session_id IS NULL OR v_client_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.sessions AS s
    WHERE s.id = v_session_id AND s.user_id = v_user_id AND s.oauth_client_id = v_client_id
  ) THEN RETURN NULL; END IF;
  SELECT preference.asset_upload_auto_execute INTO v_value
  FROM public.mcp_asset_upload_preferences AS preference
  WHERE preference.session_id = v_session_id
    AND preference.user_id = v_user_id
    AND preference.client_id = v_client_id
    AND preference.project_id = p_project_id;
  RETURN v_value;
END;
$$;
CREATE OR REPLACE FUNCTION public.mcp_set_asset_upload_auto_execute(
  p_project_id UUID,
  p_enabled BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session_id UUID;
  v_client_id UUID;
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_project_id IS NULL OR p_enabled IS NULL OR NOT (
    EXISTS (
      SELECT 1 FROM public.projects AS project
      WHERE project.id = p_project_id AND project.owner_id = v_user_id
    ) OR EXISTS (
      SELECT 1 FROM public.project_collaborators AS collaborator
      WHERE collaborator.project_id = p_project_id
        AND collaborator.user_id = v_user_id
        AND collaborator.accepted_at IS NOT NULL
        AND collaborator.role IN ('admin', 'editor')
    )
  ) THEN RETURN FALSE; END IF;
  v_session_id := CASE WHEN auth.jwt() ->> 'session_id' ~* '^[0-9a-f-]{36}$'
    THEN (auth.jwt() ->> 'session_id')::UUID END;
  v_client_id := CASE WHEN auth.jwt() ->> 'client_id' ~* '^[0-9a-f-]{36}$'
    THEN (auth.jwt() ->> 'client_id')::UUID END;
  IF v_session_id IS NULL OR v_client_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.sessions AS s
    WHERE s.id = v_session_id AND s.user_id = v_user_id AND s.oauth_client_id = v_client_id
  ) THEN RETURN FALSE; END IF;
  INSERT INTO public.mcp_asset_upload_preferences AS preference (
    session_id, user_id, client_id, project_id, asset_upload_auto_execute
  ) VALUES (v_session_id, v_user_id, v_client_id, p_project_id, p_enabled)
  ON CONFLICT (session_id, project_id) DO UPDATE SET
    asset_upload_auto_execute = EXCLUDED.asset_upload_auto_execute,
    updated_at = now();
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.mcp_get_asset_upload_auto_execute(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_get_asset_upload_auto_execute(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.mcp_set_asset_upload_auto_execute(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_set_asset_upload_auto_execute(UUID, BOOLEAN) TO authenticated;
