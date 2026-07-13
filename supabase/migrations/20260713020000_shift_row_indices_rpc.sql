-- Shift every row at or after an insertion point in one statement.
CREATE OR REPLACE FUNCTION public.shift_row_indices(
  library_id UUID,
  from_row_index INTEGER,
  delta INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
#variable_conflict use_variable
BEGIN
  UPDATE public.library_assets
  SET row_index = row_index + delta
  WHERE library_assets.library_id = library_id
    AND row_index >= from_row_index;
END;
$$;

REVOKE ALL ON FUNCTION public.shift_row_indices(UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shift_row_indices(UUID, INTEGER, INTEGER)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.shift_row_indices(UUID, INTEGER, INTEGER) IS
  'Shifts library row indices at or after an insertion point in one update.';
