-- Existing installations may already have either image validator migration.
-- Patch the deployed function definition without duplicating its full body.
do $$
declare
  v_definition text;
  v_signature constant text :=
    'public.mcp_validate_field_value(uuid,uuid,public.library_field_definitions,jsonb)';
  v_old constant text :=
    'if v_path_file_name is null or v_path_file_name <> v_image_file_name then';
  v_new constant text :=
    'if v_path_file_name is null or (v_path_file_name <> v_image_file_name'
    || ' and v_path_file_name <> (''~h'' || encode(convert_to(v_image_file_name, ''UTF8''), ''hex''))) then';
begin
  select pg_get_functiondef(v_signature::regprocedure)
    into v_definition;
  if position(v_old in v_definition) = 0 then
    raise exception 'mcp_validate_field_value definition is missing the expected image path guard';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$$;
