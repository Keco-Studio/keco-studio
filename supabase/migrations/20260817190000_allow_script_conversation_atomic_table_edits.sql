-- Table-origin dialogue edits must update the linked Script Conversation in
-- the same transaction as the source Document and sibling Tables.

do $migration$
declare
  v_signature constant text :=
    'public.replace_document_with_markdown_and_sync_tables(uuid,uuid,uuid,bigint,bigint,uuid[],text,text,text,text,jsonb)';
  v_definition text;
  v_tables_only constant text :=
    $previous$and library.document_export_type = 'table'$previous$;
  v_tables_and_script constant text :=
    $replacement$and library.document_export_type in ('table', 'script')$replacement$;
begin
  select pg_get_functiondef(to_regprocedure(v_signature)) into v_definition;
  if v_definition is null then
    raise exception 'Missing function %', v_signature;
  end if;

  if position(v_tables_only in v_definition) = 0 then
    if position(v_tables_and_script in v_definition) = 0 then
      raise exception 'Unexpected derived-library validation in function %', v_signature;
    end if;
  else
    v_definition := replace(v_definition, v_tables_only, v_tables_and_script);
  end if;

  execute v_definition;
end;
$migration$;
