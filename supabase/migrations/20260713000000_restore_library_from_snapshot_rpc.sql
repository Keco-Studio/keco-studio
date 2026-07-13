-- Replace a library's assets and values atomically from a version snapshot.
CREATE OR REPLACE FUNCTION public.restore_library_from_snapshot(
  p_library_id UUID,
  p_snapshot_data JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_snapshot_data IS NULL
     OR jsonb_typeof(p_snapshot_data -> 'assets') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid snapshot data';
  END IF;

  -- Values are removed by the library_assets foreign key cascade. Any later
  -- failure rolls this deletion back with the rest of the RPC statement.
  DELETE FROM public.library_assets
  WHERE library_id = p_library_id;

  INSERT INTO public.library_assets (
    id,
    library_id,
    name,
    created_at,
    row_index
  )
  SELECT
    (snapshot_asset.asset ->> 'id')::UUID,
    p_library_id,
    snapshot_asset.asset ->> 'name',
    COALESCE(
      NULLIF(snapshot_asset.asset ->> 'createdAt', '')::TIMESTAMPTZ,
      now()
    ),
    NULLIF(snapshot_asset.asset ->> 'rowIndex', '')::INTEGER
  FROM jsonb_array_elements(p_snapshot_data -> 'assets')
    WITH ORDINALITY AS snapshot_asset(asset, ordinal);

  INSERT INTO public.library_asset_values (asset_id, field_id, value_json)
  SELECT
    (snapshot_asset.asset ->> 'id')::UUID,
    property.key::UUID,
    property.value
  FROM jsonb_array_elements(p_snapshot_data -> 'assets') AS snapshot_asset(asset)
  CROSS JOIN LATERAL jsonb_each(
    COALESCE(snapshot_asset.asset -> 'propertyValues', '{}'::JSONB)
  ) AS property(key, value)
  WHERE property.value <> 'null'::JSONB
    AND property.value <> '""'::JSONB;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_library_from_snapshot(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_library_from_snapshot(UUID, JSONB)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.restore_library_from_snapshot(UUID, JSONB) IS
  'Atomically replaces library assets and cell values from version snapshot JSON.';
