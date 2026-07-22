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
GRANT EXECUTE ON FUNCTION public.get_oauth_authorization_resource(TEXT) TO authenticated;
