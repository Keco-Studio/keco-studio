-- Guard all old workers against silently discarding a manually edited flow.
alter function public.finalize_dialogue_script_import(uuid,text,uuid,bigint,bigint,uuid[])
  rename to finalize_dialogue_script_import_base;
revoke all on function public.finalize_dialogue_script_import_base(uuid,text,uuid,bigint,bigint,uuid[]) from public,anon,authenticated,service_role;

-- The historical stable-library path copies global primary keys before deleting
-- staging. Reparent the staging rows instead, preserving their value foreign keys.
do $$
declare definition text; old_block text; new_block text;
begin
 definition:=pg_get_functiondef('public.finalize_dialogue_script_import_base(uuid,text,uuid,bigint,bigint,uuid[])'::regprocedure);
 old_block:=$old$    insert into public.library_field_definitions(id, library_id, section, section_id, label, data_type, enum_options, reference_libraries, required, description, order_index)
      select id, v_stable.id, section, section_id, label, data_type, enum_options, reference_libraries, required, description, order_index from public.library_field_definitions where library_id = v_staging.id;
    insert into public.library_assets(id, library_id, name, row_index)
      select id, v_stable.id, name, row_index from public.library_assets where library_id = v_staging.id;
    insert into public.library_asset_values(asset_id, field_id, value_json)
      select value.asset_id, value.field_id, value.value_json from public.library_asset_values value where exists (select 1 from public.library_assets asset where asset.id = value.asset_id and asset.library_id = v_staging.id);$old$;
 new_block:=$new$    update public.library_field_definitions set library_id = v_stable.id,
      section_id = case when section = '__keco_flat_fields__' then v_stable.id::text || ':keco-flat-fields' else section_id end where library_id = v_staging.id;
    update public.library_assets set library_id = v_stable.id where library_id = v_staging.id;
    update public.libraries set plot_plan = v_staging.plot_plan where id = v_stable.id;$new$;
 definition:=replace(definition,chr(13),''); old_block:=replace(old_block,chr(13),''); new_block:=replace(new_block,chr(13),'');
 if position(old_block in definition)=0 then raise exception 'Unexpected finalization implementation; migration aborted'; end if;
 definition:=replace(definition,'set name = v_staging.name, description = v_staging.description','set description = v_staging.description');
 definition:=replace(definition,'delete from public.library_assets where library_id = v_stable.id;',
   'delete from public.library_assets where library_id = v_stable.id; update public.libraries set dialogue_generation_job_id = null where id = v_staging.id;');
 execute replace(definition,old_block,new_block);
end $$;

create function public.script_flow_regeneration_context(p_job_id uuid) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('libraryId',l.id,'projectId',l.project_id,'data',public.script_flow_data(l.id),
   'fingerprint',md5(public.script_flow_data(l.id)::text))
 from public.dialogue_generation_jobs j
 join public.gdd_generation_jobs g on g.id=j.gdd_generation_job_id
 join public.gdd_series_resources r on r.series_id=g.generation_series_id and r.resource_kind='script_table'
   and r.logical_key=lower(regexp_replace(btrim(j.chapter_key),'\s+',' ','g'))
 join public.libraries l on l.id=r.library_id
 join public.script_flow_states s on s.library_id=l.id
 where j.id=p_job_id;
$$;
revoke all on function public.script_flow_regeneration_context(uuid) from public,anon,authenticated;
grant execute on function public.script_flow_regeneration_context(uuid) to service_role;

create function public.finalize_dialogue_script_import(p_job_id uuid,p_worker_id text,p_script_library_id uuid,
 p_source_epoch bigint,p_source_revision bigint,p_source_update_ids uuid[])
returns table(script_library_id uuid,action text) language plpgsql security definer set search_path='' as $$
begin
 if public.script_flow_regeneration_context(p_job_id) is not null then
   raise exception 'Script has flow edits; a verified flow regeneration is required' using errcode='PT409';
 end if;
 return query select * from public.finalize_dialogue_script_import_base(p_job_id,p_worker_id,p_script_library_id,p_source_epoch,p_source_revision,p_source_update_ids);
end $$;
revoke all on function public.finalize_dialogue_script_import(uuid,text,uuid,bigint,bigint,uuid[]) from public,anon,authenticated;
grant execute on function public.finalize_dialogue_script_import(uuid,text,uuid,bigint,bigint,uuid[]) to service_role;

create function public.finalize_dialogue_script_import_with_flow(p_job_id uuid,p_worker_id text,p_script_library_id uuid,
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
     if item#>>'{values,Commands}' is distinct from 'End' or coalesce(item#>>'{values,Content}','')<>'' then
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
