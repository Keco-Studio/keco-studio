-- Generated rows store their display name in library_assets.name. Keep a
-- declared `name` field populated as a normal cell as well.

update public.library_asset_values as cell
set value_json = to_jsonb(asset.name)
from public.library_assets as asset
join public.libraries as library on library.id = asset.library_id
join public.library_field_definitions as field_definition
  on field_definition.library_id = library.id
 and lower(btrim(field_definition.label)) = 'name'
where cell.asset_id = asset.id
  and cell.field_id = field_definition.id
  and library.gdd_generation_job_id is not null
  and (cell.value_json is null or cell.value_json = 'null'::jsonb)
  and btrim(asset.name) <> ''
  and asset.name <> 'Untitled';

notify pgrst, 'reload schema';
