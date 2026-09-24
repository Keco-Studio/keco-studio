-- Atomically validate a registered Keco user and grant global Admin access.
-- It is intentionally executable only by the server's service-role client.

CREATE OR REPLACE FUNCTION public.grant_keco_admin_by_email(target_email TEXT)
RETURNS TABLE(status TEXT, user_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_email TEXT := lower(btrim(target_email));
  target_user_id UUID;
BEGIN
  SELECT candidate.id
  INTO target_user_id
  FROM auth.users AS candidate
  WHERE lower(candidate.email) = normalized_email
  LIMIT 1;

  IF target_user_id IS NULL THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO public.keco_admin_users (user_id)
  VALUES (target_user_id)
  ON CONFLICT ON CONSTRAINT keco_admin_users_pkey DO NOTHING;

  IF FOUND THEN
    RETURN QUERY SELECT 'granted'::TEXT, target_user_id;
  ELSE
    RETURN QUERY SELECT 'already_admin'::TEXT, target_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_keco_admin_by_email(TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grant_keco_admin_by_email(TEXT) TO service_role;
