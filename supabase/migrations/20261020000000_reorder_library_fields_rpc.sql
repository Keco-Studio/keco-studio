-- Reorder every field in a library atomically. The temporary negative range
-- prevents the unique (section_id, order_index) constraint from seeing a swap.
CREATE OR REPLACE FUNCTION public.reorder_library_fields(
  p_library_id UUID,
  p_field_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_library public.libraries%ROWTYPE;
  v_actor UUID := auth.uid();
  v_field_count INTEGER;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_library
  FROM public.libraries
  WHERE id = p_library_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Table not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    public.is_project_owner(v_library.project_id, v_actor)
    OR public.is_editor_or_admin_collaborator(v_library.project_id, v_actor)
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_field_count
  FROM public.library_field_definitions
  WHERE library_id = p_library_id;

  IF v_field_count <> cardinality(p_field_ids)
    OR (SELECT count(DISTINCT field_id) FROM unnest(p_field_ids) AS requested(field_id)) <> v_field_count
    OR EXISTS (
      SELECT 1
      FROM unnest(p_field_ids) AS requested(field_id)
      LEFT JOIN public.library_field_definitions AS field
        ON field.id = requested.field_id AND field.library_id = p_library_id
      WHERE field.id IS NULL
    )
  THEN
    RAISE EXCEPTION 'Column order must contain every column exactly once' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.library_field_definitions
  WHERE library_id = p_library_id
  FOR UPDATE;

  UPDATE public.library_field_definitions AS field
  SET order_index = -field.order_index - 1
  WHERE field.library_id = p_library_id;

  UPDATE public.library_field_definitions AS field
  SET order_index = requested.ordinality::INTEGER - 1
  FROM unnest(p_field_ids) WITH ORDINALITY AS requested(field_id, ordinality)
  WHERE field.id = requested.field_id
    AND field.library_id = p_library_id;

  UPDATE public.libraries
  SET updated_at = now(), updated_by = v_actor
  WHERE id = p_library_id;
  UPDATE public.projects SET updated_at = now() WHERE id = v_library.project_id;
  IF v_library.folder_id IS NOT NULL THEN
    UPDATE public.folders SET updated_at = now() WHERE id = v_library.folder_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_library_fields(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_library_fields(UUID, UUID[]) TO authenticated;

COMMENT ON FUNCTION public.reorder_library_fields(UUID, UUID[]) IS
  'Atomically reorders the complete set of field definitions for a library.';
