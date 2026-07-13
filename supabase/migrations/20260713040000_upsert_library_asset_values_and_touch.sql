-- Persist all values produced by one cell edit and touch ancestor timestamps in
-- the same transaction. This preserves one authoritative timestamp for LWW.
CREATE OR REPLACE FUNCTION public.upsert_library_asset_values_and_touch(
  p_asset_id UUID,
  p_library_id UUID,
  p_values JSONB
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_project_id UUID;
  v_folder_id UUID;
  v_asset_updated_at TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: auth.uid() is null'
      USING ERRCODE = '42501';
  END IF;

  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION 'p_values must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  SELECT l.project_id, l.folder_id
    INTO v_project_id, v_folder_id
  FROM public.libraries l
  JOIN public.library_assets la ON la.library_id = l.id
  WHERE l.id = p_library_id
    AND la.id = p_asset_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Asset % was not found in library %', p_asset_id, p_library_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    public.is_project_owner(v_project_id, v_user_id)
    OR public.is_editor_or_admin_collaborator(v_project_id, v_user_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: missing editor access to library %', p_library_id
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_values) AS requested(field_id)
    LEFT JOIN public.library_field_definitions field_definition
      ON field_definition.id::TEXT = requested.field_id
      AND field_definition.library_id = p_library_id
    WHERE field_definition.id IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more fields do not belong to library %', p_library_id
      USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.library_asset_values (asset_id, field_id, value_json)
  SELECT p_asset_id, value_entry.key::UUID, value_entry.value
  FROM jsonb_each(p_values) AS value_entry
  ON CONFLICT (asset_id, field_id)
  DO UPDATE SET value_json = EXCLUDED.value_json;

  UPDATE public.library_assets
    SET updated_at = now()
  WHERE id = p_asset_id
    AND library_id = p_library_id
  RETURNING updated_at INTO v_asset_updated_at;

  UPDATE public.libraries
    SET updated_at = v_asset_updated_at
  WHERE id = p_library_id;

  UPDATE public.projects
    SET updated_at = v_asset_updated_at
  WHERE id = v_project_id;

  IF v_folder_id IS NOT NULL THEN
    UPDATE public.folders
      SET updated_at = v_asset_updated_at
    WHERE id = v_folder_id;
  END IF;

  RETURN v_asset_updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_library_asset_values_and_touch(UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_library_asset_values_and_touch(UUID, UUID, JSONB) TO authenticated;

COMMENT ON FUNCTION public.upsert_library_asset_values_and_touch(UUID, UUID, JSONB) IS
  'Upserts one cell edit and derived values, touches ancestor timestamps, and returns the authoritative edit timestamp.';
