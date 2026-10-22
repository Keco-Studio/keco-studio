-- Keep a field rename and all dependent formula-expression changes atomic.
CREATE OR REPLACE FUNCTION public.update_library_field_with_formula_references(
  p_library_id uuid,
  p_field_id uuid,
  p_field jsonb,
  p_formula_updates jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_library public.libraries%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_formula_updates) <> 'array' THEN
    RAISE EXCEPTION 'Formula updates must be an array' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_library
  FROM public.libraries
  WHERE id = p_library_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Table not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT coalesce(public.is_project_owner_or_admin(v_library.project_id, v_actor), false) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.library_field_definitions
  WHERE library_id = p_library_id
  FOR UPDATE;

  UPDATE public.library_field_definitions
  SET
    label = btrim(p_field ->> 'label'),
    description = nullif(btrim(coalesce(p_field ->> 'description', '')), ''),
    data_type = p_field ->> 'dataType',
    formula_expression = nullif(btrim(coalesce(p_field ->> 'formulaExpression', '')), ''),
    enum_options = CASE
      WHEN coalesce(jsonb_typeof(p_field -> 'enumOptions'), 'null') <> 'array' THEN NULL
      ELSE ARRAY(SELECT jsonb_array_elements_text(p_field -> 'enumOptions'))
    END,
    reference_libraries = CASE
      WHEN coalesce(jsonb_typeof(p_field -> 'referenceLibraries'), 'null') <> 'array' THEN NULL
      ELSE ARRAY(SELECT jsonb_array_elements_text(p_field -> 'referenceLibraries')::uuid)
    END
  WHERE library_id = p_library_id
    AND id = p_field_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Column not found' USING ERRCODE = 'P0002';
  END IF;

  WITH formula_updates AS (
    SELECT
      (item ->> 'fieldId')::uuid AS field_id,
      item ->> 'expectedFormulaExpression' AS expected_formula_expression,
      item ->> 'formulaExpression' AS formula_expression
    FROM jsonb_array_elements(p_formula_updates) AS item
  ), verified_updates AS (
    SELECT formula_updates.*
    FROM formula_updates
    JOIN public.library_field_definitions AS field
      ON field.id = formula_updates.field_id
      AND field.library_id = p_library_id
      AND field.data_type = 'formula'
      AND field.formula_expression IS NOT DISTINCT FROM formula_updates.expected_formula_expression
  )
  UPDATE public.library_field_definitions AS field
  SET formula_expression = verified_updates.formula_expression
  FROM verified_updates
  WHERE field.library_id = p_library_id
    AND field.id = verified_updates.field_id;

  IF (SELECT count(*) FROM jsonb_array_elements(p_formula_updates)) <>
     (SELECT count(*) FROM public.library_field_definitions AS field
      JOIN jsonb_array_elements(p_formula_updates) AS item
        ON field.id = (item ->> 'fieldId')::uuid
       AND field.library_id = p_library_id
       AND field.data_type = 'formula'
       AND field.formula_expression IS NOT DISTINCT FROM item ->> 'formulaExpression') THEN
    RAISE EXCEPTION 'Formula expressions changed during column rename. Please retry.' USING ERRCODE = '40001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_library_field_with_formula_references(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_library_field_with_formula_references(uuid, uuid, jsonb, jsonb) TO authenticated;
