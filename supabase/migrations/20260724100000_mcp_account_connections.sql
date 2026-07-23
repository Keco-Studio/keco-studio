-- Account-level MCP connection listing and exact-session revocation.

CREATE OR REPLACE FUNCTION public.list_oauth_mcp_account_connections(
  p_user_id UUID
)
RETURNS TABLE (
  authorization_id TEXT,
  client_name TEXT,
  connected_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    grant_row.authorization_id,
    oauth_client.client_name,
    grant_row.exchanged_at AS connected_at
  FROM public.oauth_mcp_service_grants AS grant_row
  JOIN auth.sessions AS session_row
    ON session_row.id = grant_row.session_id
   AND session_row.user_id = grant_row.user_id
   AND session_row.oauth_client_id = grant_row.client_id
  JOIN auth.oauth_clients AS oauth_client
    ON oauth_client.id = grant_row.client_id
   AND oauth_client.deleted_at IS NULL
  JOIN auth.oauth_consents AS consent_row
    ON consent_row.user_id = grant_row.user_id
   AND consent_row.client_id = grant_row.client_id
   AND consent_row.revoked_at IS NULL
  WHERE p_user_id IS NOT NULL
    AND grant_row.user_id = p_user_id
    AND grant_row.resource =
      'https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp'
    AND grant_row.approved_at IS NOT NULL
    AND grant_row.exchanged_at IS NOT NULL
  ORDER BY grant_row.exchanged_at DESC, grant_row.authorization_id ASC;
$$;

REVOKE ALL ON FUNCTION public.list_oauth_mcp_account_connections(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_oauth_mcp_account_connections(UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.revoke_oauth_mcp_account_connection(
  p_user_id UUID,
  p_authorization_id TEXT
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
BEGIN
  IF p_user_id IS NULL OR p_authorization_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT grant_row.session_id, grant_row.client_id
  INTO v_session_id, v_client_id
  FROM public.oauth_mcp_service_grants AS grant_row
  JOIN auth.sessions AS session_row
    ON session_row.id = grant_row.session_id
   AND session_row.user_id = grant_row.user_id
   AND session_row.oauth_client_id = grant_row.client_id
  JOIN auth.oauth_clients AS oauth_client
    ON oauth_client.id = grant_row.client_id
   AND oauth_client.deleted_at IS NULL
  JOIN auth.oauth_consents AS consent_row
    ON consent_row.user_id = grant_row.user_id
   AND consent_row.client_id = grant_row.client_id
   AND consent_row.revoked_at IS NULL
  WHERE grant_row.authorization_id = p_authorization_id
    AND grant_row.user_id = p_user_id
    AND grant_row.resource =
      'https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp'
    AND grant_row.approved_at IS NOT NULL
    AND grant_row.exchanged_at IS NOT NULL
  FOR UPDATE OF grant_row, session_row;

  IF v_session_id IS NULL THEN
    RETURN FALSE;
  END IF;

  DELETE FROM auth.sessions AS session_row
  WHERE session_row.id = v_session_id
    AND session_row.user_id = p_user_id
    AND session_row.oauth_client_id = v_client_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.oauth_mcp_service_grants AS grant_row
    WHERE grant_row.authorization_id = p_authorization_id
       OR grant_row.session_id = v_session_id
  ) THEN
    RAISE EXCEPTION 'MCP connection revocation failed';
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_oauth_mcp_account_connection(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_oauth_mcp_account_connection(UUID, TEXT)
  TO service_role;
