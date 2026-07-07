-- Collapse cell-edit timestamp fan-out into a single authenticated RPC.
--
-- updateAssetField already persists library_asset_values before calling this
-- helper. This function updates the edited asset timestamp and the parent
-- library/project/folder timestamps from one client round trip.

CREATE OR REPLACE FUNCTION public.touch_library_asset_edit_updated_at(
  p_asset_id UUID,
  p_library_id UUID
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

REVOKE ALL ON FUNCTION public.touch_library_asset_edit_updated_at(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_library_asset_edit_updated_at(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.touch_library_asset_edit_updated_at(UUID, UUID) IS
  'Touch asset, library, folder, and project updated_at timestamps for a cell edit from one RPC call.';
