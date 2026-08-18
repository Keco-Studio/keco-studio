-- Upgrade databases where the original atomic Script/Table RPC was already installed.

do $migration$
declare
  v_signature constant text :=
    'public.replace_document_with_markdown_and_sync_tables(uuid,uuid,uuid,bigint,bigint,uuid[],text,text,text,text,jsonb)';
  v_definition text;
  v_previous constant text :=
    $previous$if v_speaker = '' or v_speech_type not in ('1', '2') then$previous$;
  v_replacement constant text :=
    $replacement$if v_speaker = ''
        or (v_operation_type = 'insert' and v_speech_type not in ('1', '2'))
        or (v_operation_type = 'edit' and v_speech_type not in ('1', '2', '3'))
      then$replacement$;
  v_all_tables_required constant text :=
    $previous$if v_operation_count <> v_expected_table_count
    or v_distinct_operation_count <> v_operation_count$previous$;
  v_only_prepared_tables constant text :=
    $replacement$if v_distinct_operation_count <> v_operation_count$replacement$;
begin
  select pg_get_functiondef(to_regprocedure(v_signature)) into v_definition;
  if v_definition is null then
    raise exception 'Missing function %', v_signature;
  end if;

  if position(v_previous in v_definition) = 0 then
    if position(v_replacement in v_definition) = 0 then
      raise exception 'Unexpected value validation body in function %', v_signature;
    end if;
  else
    v_definition := replace(v_definition, v_previous, v_replacement);
  end if;

  if position(v_all_tables_required in v_definition) = 0 then
    if position(v_only_prepared_tables in v_definition) = 0 then
      raise exception 'Unexpected table-set validation body in function %', v_signature;
    end if;
  else
    v_definition := replace(
      v_definition,
      v_all_tables_required,
      v_only_prepared_tables
    );
  end if;

  execute v_definition;
end;
$migration$;
