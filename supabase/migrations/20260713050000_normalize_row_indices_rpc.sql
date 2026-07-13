-- Normalize an ordered asset list in one statement instead of one REST update
-- per row. Row-level update policies continue to enforce editor access.
CREATE OR REPLACE FUNCTION public.normalize_row_indices(
  p_library_id UUID,
  p_asset_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.library_assets AS asset
  SET row_index = requested.row_index
  FROM (
    SELECT asset_id, ordinality::INTEGER AS row_index
    FROM unnest(p_asset_ids) WITH ORDINALITY AS ordered(asset_id, ordinality)
  ) AS requested
  WHERE asset.id = requested.asset_id
    AND asset.library_id = p_library_id
    AND asset.row_index IS DISTINCT FROM requested.row_index;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_row_indices(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_row_indices(UUID, UUID[])
  TO authenticated, service_role;

COMMENT ON FUNCTION public.normalize_row_indices(UUID, UUID[]) IS
  'Normalizes library asset row indices to the supplied display order in one update.';
