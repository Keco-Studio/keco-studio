create or replace function public.save_script_flow(p_project_id uuid,p_library_id uuid,p_actor uuid,p_expected text,
 p_request_id uuid,p_hash text,p_rows jsonb,p_state jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 v_data jsonb; v_result jsonb; v_old_request public.script_flow_requests;
 v_source_id uuid; v_row jsonb; v_pair record; v_field uuid; v_index integer:=0;
 v_old jsonb; v_existing boolean;
begin
 if not (public.is_project_owner(p_project_id,p_actor) or public.is_editor_or_admin_collaborator(p_project_id,p_actor)) then
   raise exception 'Project edit access required' using errcode='42501';
 end if;
 select source_document_id into v_source_id from public.libraries where id=p_library_id and project_id=p_project_id;
 if not found then raise exception 'Script not found' using errcode='P0002'; end if;
 -- Same ordering as source-document synchronization: document before library.
 if v_source_id is not null then perform 1 from public.documents where id=v_source_id for update; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_library_id::text,0));
 perform 1 from public.libraries where id=p_library_id for update;
 select * into v_old_request from public.script_flow_requests where library_id=p_library_id and request_id=p_request_id;
 if found then
   if v_old_request.actor_id is distinct from p_actor or v_old_request.request_hash is distinct from p_hash then
     raise exception 'Request key reused' using errcode='PT409';
   end if;
   return v_old_request.result;
 end if;
 perform 1 from public.library_field_definitions where library_id=p_library_id order by id for update;
 perform 1 from public.library_assets where library_id=p_library_id order by id for update;
 perform 1 from public.library_asset_values v join public.library_assets a on a.id=v.asset_id
   where a.library_id=p_library_id order by v.asset_id,v.field_id for update of v;
 v_data:=public.script_flow_data(p_library_id);
 if md5(v_data::text) is distinct from p_expected then raise exception 'Script or source changed; refresh preview' using errcode='PT409'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 5000
   or octet_length(p_rows::text)>1048576 or p_state->>'version' is distinct from '1' then
   raise exception 'Invalid structure payload' using errcode='22023';
 end if;
 if (select count(*) from jsonb_array_elements(p_rows)) <> (select count(distinct r->>'id') from jsonb_array_elements(p_rows) r)
   or exists(select 1 from public.library_assets a where a.library_id=p_library_id and not exists(select 1 from jsonb_array_elements(p_rows) r where r->>'id'=a.id::text)) then
   raise exception 'Rows may not be deleted or duplicated' using errcode='22023';
 end if;
 if exists(select label from public.library_field_definitions where library_id=p_library_id group by label having count(*)>1) then
   raise exception 'Ambiguous fields' using errcode='22023';
 end if;
 -- Normalize indices without changing the authoritative ordering. Legacy rows
 -- can have gaps or NULL indices; array length is not their physical tail.
 with ordered as (select id,row_number() over(order by row_index nulls last,created_at,id)::integer as ordinal
   from public.library_assets where library_id=p_library_id)
 update public.library_assets a set row_index=o.ordinal from ordered o where a.id=o.id;
 for v_row in select value from jsonb_array_elements(p_rows) loop
   v_index:=v_index+1;
   select jsonb_object_agg(f.label,v.value_json) into v_old from public.library_assets a
     join public.library_asset_values v on v.asset_id=a.id join public.library_field_definitions f on f.id=v.field_id
     where a.id=(v_row->>'id')::uuid and a.library_id=p_library_id;
   v_existing:=exists(select 1 from public.library_assets where id=(v_row->>'id')::uuid and library_id=p_library_id);
   if v_existing then
     -- Row order and ordinary values cannot be changed by the structure editor.
     if (v_data->'assets'->(v_index-1)->>'id') is distinct from v_row->>'id' then
       raise exception 'Row order changed' using errcode='22023';
     end if;
     for v_pair in select key,value from jsonb_each(coalesce(v_old,'{}')) loop
       if v_pair.key !~ '^(Label|Commands|Option[0-9]+(_Next|_Commands)?)$'
         and v_row->'values'->v_pair.key is distinct from v_pair.value then
         raise exception 'Ordinary values cannot change' using errcode='22023';
       end if;
     end loop;
   else
     if exists(select 1 from public.library_assets where id=(v_row->>'id')::uuid)
       or (not coalesce(p_state->'copiedIds' ? (v_row->>'id'),false) and (v_row#>>'{values,Commands}' is distinct from 'End' or v_row#>>'{values,Type}' is distinct from '4'
       or coalesce(v_row#>>'{values,Content}','')<>'')) then
       raise exception 'Only independent terminal rows can be added' using errcode='22023';
     end if;
     insert into public.library_assets(id,library_id,name,row_index) values((v_row->>'id')::uuid,p_library_id,'',v_index);
   end if;
   for v_pair in select key,value from jsonb_each(v_row->'values') loop
     if v_existing and v_pair.key !~ '^(Label|Commands|Option[0-9]+(_Next|_Commands)?)$' then
       if v_old->v_pair.key is distinct from v_pair.value and v_pair.value <> '""'::jsonb then
         raise exception 'Ordinary values cannot change' using errcode='22023';
       end if;
       continue;
     end if;
     select id into v_field from public.library_field_definitions where library_id=p_library_id and label=v_pair.key;
     if not found then
       if v_pair.key !~ '^(Label|Type|Content|Commands|Option[0-9]+(_Next|_Commands)?)$' then
         raise exception 'Unknown structure field' using errcode='22023';
       end if;
       insert into public.library_field_definitions(library_id,section,section_id,label,data_type,order_index)
       values(p_library_id,'__keco_flat_fields__',p_library_id::text||':keco-flat-fields',v_pair.key,'string',
         (select coalesce(max(order_index),0)+1 from public.library_field_definitions where library_id=p_library_id)) returning id into v_field;
     end if;
     insert into public.library_asset_values(asset_id,field_id,value_json) values((v_row->>'id')::uuid,v_field,v_pair.value)
       on conflict(asset_id,field_id) do update set value_json=excluded.value_json;
   end loop;
 end loop;
 insert into public.script_flow_states(library_id,state) values(p_library_id,p_state - 'pastePlotPlan')
   on conflict(library_id) do update set state=excluded.state,updated_at=clock_timestamp();
 -- Stale plot edges must never override actual Script control flow.
 update public.libraries set updated_at=clock_timestamp(),plot_plan=coalesce(p_state->'pastePlotPlan',plot_plan) where id=p_library_id;
 update public.projects set updated_at=clock_timestamp() where id=p_project_id;
 v_result:=jsonb_build_object('libraryId',p_library_id,'requestId',p_request_id);
 insert into public.script_flow_requests values(p_library_id,p_request_id,p_actor,p_hash,v_result);
 return v_result;
end;
$$;
revoke all on function public.save_script_flow(uuid,uuid,uuid,text,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_script_flow(uuid,uuid,uuid,text,uuid,text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';

create or replace function public.finalize_dialogue_script_import_with_flow(p_job_id uuid,p_worker_id text,p_script_library_id uuid,
 p_source_epoch bigint,p_source_revision bigint,p_source_update_ids uuid[],p_expected_flow text,p_rows jsonb,p_state jsonb)
returns table(script_library_id uuid,action text) language plpgsql security definer set search_path='' as $$
declare ctx jsonb; stable_id uuid; doc_id uuid; item jsonb; pair record; v_field_id uuid; old_field jsonb;
 idx integer:=0; final_id uuid; final_action text;
begin
 select document_id into doc_id from public.dialogue_generation_jobs where id=p_job_id for update;
 perform 1 from public.documents where id=doc_id for update;
 ctx:=public.script_flow_regeneration_context(p_job_id);
 if ctx is null then raise exception 'Flow source disappeared' using errcode='PT409'; end if;
 stable_id:=(ctx->>'libraryId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(stable_id::text,0));
 perform 1 from public.libraries where id in(stable_id,p_script_library_id) order by id for update;
 perform 1 from public.library_assets where library_id in(stable_id,p_script_library_id) order by id for update;
 perform 1 from public.library_field_definitions where library_id in(stable_id,p_script_library_id) order by id for update;
 perform 1 from public.library_asset_values v join public.library_assets a on a.id=v.asset_id
   where a.library_id in(stable_id,p_script_library_id) order by v.asset_id,v.field_id for update of v;
 ctx:=public.script_flow_regeneration_context(p_job_id);
 if ctx->>'fingerprint' is distinct from p_expected_flow then raise exception 'Flow changed during generation' using errcode='PT409'; end if;
 if not exists(select 1 from public.libraries where id=p_script_library_id and source_document_id=doc_id
   and project_id=(ctx->>'projectId')::uuid and dialogue_generation_job_id=p_job_id and not dialogue_generation_ready) then
   raise exception 'Invalid staging library' using errcode='42501';
 end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 5000
   or octet_length(p_rows::text)>1048576 or p_state->>'version' is distinct from '1' then
   raise exception 'Invalid regenerated flow' using errcode='22023';
 end if;
 if exists(select 1 from public.library_assets a where a.library_id=p_script_library_id
   and not exists(select 1 from jsonb_array_elements(p_rows) r where r->>'id'=a.id::text)) then
   raise exception 'Generated rows cannot be omitted' using errcode='22023';
 end if;
 for item in select value from jsonb_array_elements(p_rows) loop
   idx:=idx+1;
   if not exists(select 1 from public.library_assets where id=(item->>'id')::uuid and library_id=p_script_library_id) then
     if not coalesce(p_state->'copiedIds' ? (item->>'id'),false) and (item#>>'{values,Commands}' is distinct from 'End' or coalesce(item#>>'{values,Content}','')<>'') then
       raise exception 'Only terminal rows may be appended' using errcode='22023';
     end if;
     insert into public.library_assets(id,library_id,name,row_index) values((item->>'id')::uuid,p_script_library_id,'',idx);
   end if;
   for pair in select key,value from jsonb_each(item->'values') loop
     select id into v_field_id from public.library_field_definitions where library_id=p_script_library_id and label=pair.key;
     if not found then
       select f into old_field from jsonb_array_elements(ctx#>'{data,fields}') f where f->>'label'=pair.key;
       if old_field is null then raise exception 'Unknown regenerated field' using errcode='22023'; end if;
       insert into public.library_field_definitions(library_id,section,section_id,label,data_type,enum_options,reference_libraries,formula_expression,required,order_index)
         select p_script_library_id,'__keco_flat_fields__',p_script_library_id::text||':keco-flat-fields',label,data_type,enum_options,reference_libraries,formula_expression,required,
           (select coalesce(max(order_index),0)+1 from public.library_field_definitions where library_id=p_script_library_id)
         from public.library_field_definitions where id=(old_field->>'id')::uuid returning id into v_field_id;
     end if;
     insert into public.library_asset_values(asset_id,field_id,value_json) values((item->>'id')::uuid,v_field_id,pair.value)
       on conflict(asset_id,field_id) do update set value_json=excluded.value_json;
   end loop;
 end loop;
 select f.script_library_id,f.action into final_id,final_action from public.finalize_dialogue_script_import_base(
   p_job_id,p_worker_id,p_script_library_id,p_source_epoch,p_source_revision,p_source_update_ids) f;
 if final_id is distinct from stable_id then raise exception 'Stable flow mapping changed' using errcode='PT409'; end if;
 update public.script_flow_states set state=p_state,updated_at=clock_timestamp() where library_id=stable_id;
 return query select final_id,final_action;
end $$;
revoke all on function public.finalize_dialogue_script_import_with_flow(uuid,text,uuid,bigint,bigint,uuid[],text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_dialogue_script_import_with_flow(uuid,text,uuid,bigint,bigint,uuid[],text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';

-- A Script owns its source document. Copy both in one transaction and rekey
-- the row-bound flow state so edits to the duplicate cannot affect the source.
create function public.duplicate_flow_script(p_project_id uuid,p_library_id uuid,p_actor uuid,p_expected text,p_request_id uuid,p_name text,p_markdown text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_doc uuid; v_new_doc uuid:=gen_random_uuid(); v_new_id uuid:=gen_random_uuid();
 v_hash text:=md5(jsonb_build_array('duplicate',p_name,p_expected)::text);
 receipt public.script_flow_requests; v_state jsonb; v_result jsonb;
begin
 if not coalesce(public.is_project_owner(p_project_id,p_actor) or public.is_editor_or_admin_collaborator(p_project_id,p_actor),false) then
   raise exception 'Writer required' using errcode='42501'; end if;
 if length(trim(p_name)) not between 1 and 80 then raise exception 'Invalid name' using errcode='22023'; end if;
 select source_document_id into v_doc from public.libraries where id=p_library_id and project_id=p_project_id and document_export_type='script';
 if v_doc is null then raise exception 'Script not found' using errcode='P0002'; end if;
 perform 1 from public.documents where id=v_doc and project_id=p_project_id for update;
 if not found then raise exception 'Invalid source' using errcode='P0002'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_library_id::text,0));
 perform 1 from public.libraries where id=p_library_id for update;
 select * into receipt from public.script_flow_requests where library_id=p_library_id and request_id=p_request_id;
 if found then
   if receipt.actor_id<>p_actor or receipt.request_hash<>v_hash then raise exception 'Request key reused' using errcode='PT409'; end if;
   return receipt.result;
 end if;
 perform 1 from public.library_field_definitions where library_id=p_library_id order by id for update;
 perform 1 from public.library_assets where library_id=p_library_id order by id for update;
 perform 1 from public.library_asset_values v join public.library_assets a on a.id=v.asset_id where a.library_id=p_library_id order by v.asset_id,v.field_id for update of v;
 if md5(public.script_flow_data(p_library_id)::text) is distinct from p_expected then raise exception 'Source changed' using errcode='PT409'; end if;
 insert into public.documents(id,project_id,name,content,created_by) values(v_new_doc,p_project_id,p_name,p_markdown,p_actor);
 insert into public.script_workspace_documents(project_id,document_id,imported_by) values(p_project_id,v_new_doc,p_actor);
 insert into public.libraries(id,project_id,folder_id,name,description,source_document_id,document_export_type,plot_plan)
 select v_new_id,p_project_id,folder_id,p_name,description,v_new_doc,'script',plot_plan from public.libraries where id=p_library_id;
 perform private.agent_setup_copy_maps();
  insert into pg_temp.agent_copy_field_map (old_id, new_id, new_order)
  select field.id, gen_random_uuid(),
    (row_number() over (order by field.order_index, field.id) - 1)::integer
  from public.library_field_definitions field where field.library_id = p_library_id;

  insert into public.library_field_definitions (
    id, library_id, section, label, data_type, enum_options, required,
    order_index, reference_libraries, section_id, description, formula_expression
  )
  select map.new_id, v_new_id, '__keco_flat_fields__', field.label,
    field.data_type, field.enum_options, field.required, map.new_order,
    field.reference_libraries, v_new_id::text || ':keco-flat-fields',
    field.description, field.formula_expression
  from public.library_field_definitions field
  join pg_temp.agent_copy_field_map map on map.old_id = field.id
  order by map.new_order;

    insert into pg_temp.agent_copy_asset_map (old_id, new_id)
      select asset.id, gen_random_uuid() from public.library_assets asset
      where asset.library_id = p_library_id;
    insert into public.library_assets (id, library_id, name, row_index)
      select map.new_id, v_new_id, asset.name, (row_number() over(order by asset.row_index nulls last,asset.created_at,asset.id)-1)::integer
      from public.library_assets asset
      join pg_temp.agent_copy_asset_map map on map.old_id = asset.id;
    insert into public.library_asset_values (asset_id, field_id, value_json)
      select asset_map.new_id, field_map.new_id, value.value_json
      from public.library_asset_values value
      join pg_temp.agent_copy_asset_map asset_map on asset_map.old_id = value.asset_id
      join pg_temp.agent_copy_field_map field_map on field_map.old_id = value.field_id;

 select state into v_state from public.script_flow_states where library_id=p_library_id;
 if found then
   insert into public.script_flow_states(library_id,state) values(v_new_id,jsonb_build_object('version',1,
     'bindings',coalesce((select jsonb_agg(b||jsonb_build_object('rowId',m.new_id)) from jsonb_array_elements(v_state->'bindings') b join pg_temp.agent_copy_asset_map m on m.old_id=(b->>'rowId')::uuid),'[]'::jsonb),
     'terminalIds',coalesce((select jsonb_agg(m.new_id) from pg_temp.agent_copy_asset_map m where v_state->'terminalIds' ? m.old_id::text),'[]'::jsonb),
     'copiedIds',coalesce((select jsonb_agg(m.new_id) from pg_temp.agent_copy_asset_map m where v_state->'copiedIds' ? m.old_id::text),'[]'::jsonb)));
 end if;
 v_result=jsonb_build_object('libraryId',v_new_id);
 insert into public.script_flow_requests(library_id,request_id,actor_id,request_hash,result) values(p_library_id,p_request_id,p_actor,v_hash,v_result);
 return v_result;
end $$;
revoke all on function public.duplicate_flow_script(uuid,uuid,uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.duplicate_flow_script(uuid,uuid,uuid,text,uuid,text,text) to service_role;
notify pgrst,'reload schema';
