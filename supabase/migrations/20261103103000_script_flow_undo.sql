-- Keep a bounded, server-owned preimage for each successful graph edit.
create table public.script_flow_undo (
 library_id uuid references public.libraries on delete cascade, request_id uuid, actor_id uuid not null,
 before_data jsonb not null, after_hash text not null, saved_at timestamptz default clock_timestamp(),
 primary key(library_id,request_id)
);
alter table public.script_flow_undo enable row level security;
revoke all on public.script_flow_undo from public,anon,authenticated;
alter function public.save_script_flow(uuid,uuid,uuid,text,uuid,text,jsonb,jsonb) rename to save_script_flow_base;
revoke all on function public.save_script_flow_base(uuid,uuid,uuid,text,uuid,text,jsonb,jsonb) from service_role;
create function public.save_script_flow(p_project_id uuid,p_library_id uuid,p_actor uuid,p_expected text,p_request_id uuid,p_hash text,p_rows jsonb,p_state jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_data jsonb; result jsonb;
begin
 old_data:=public.script_flow_data(p_library_id);
 result:=public.save_script_flow_base(p_project_id,p_library_id,p_actor,p_expected,p_request_id,p_hash,p_rows,p_state);
 -- An idempotent replay must never replace the original undo record.
 if md5(old_data::text)=p_expected then
   insert into public.script_flow_undo(library_id,request_id,actor_id,before_data,after_hash)
   values(p_library_id,p_request_id,p_actor,old_data,md5((public.script_flow_data(p_library_id)#-'{library,updated_at}')::text))
   on conflict do nothing;
   delete from public.script_flow_undo where library_id=p_library_id and request_id in
   (select request_id from public.script_flow_undo where library_id=p_library_id order by saved_at desc offset 20);
 end if;
 return result;
end $$;
revoke all on function public.save_script_flow(uuid,uuid,uuid,text,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_script_flow(uuid,uuid,uuid,text,uuid,text,jsonb,jsonb) to service_role;

create function public.undo_script_flow(p_project_id uuid,p_library_id uuid,p_actor uuid,p_request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare doc uuid; h public.script_flow_undo; row_data jsonb;
begin
 if not coalesce(public.is_project_owner(p_project_id,p_actor) or public.is_editor_or_admin_collaborator(p_project_id,p_actor),false)
 then raise exception 'Writer required' using errcode='42501';end if;
 select source_document_id into doc from public.libraries where id=p_library_id and project_id=p_project_id;
 if not found then raise exception 'Script not found' using errcode='P0002';end if;
 perform 1 from public.documents where id=doc for update;
 perform pg_advisory_xact_lock(hashtextextended(p_library_id::text,0));
 perform 1 from public.libraries where id=p_library_id for update;
 perform 1 from public.library_field_definitions where library_id=p_library_id order by id for update;
 perform 1 from public.library_assets where library_id=p_library_id order by id for update;
 perform 1 from public.library_asset_values v join public.library_assets a on a.id=v.asset_id where a.library_id=p_library_id order by v.asset_id,v.field_id for update of v;
 select * into h from public.script_flow_undo where library_id=p_library_id and request_id=p_request_id and actor_id=p_actor;
 if not found or h.after_hash<>md5((public.script_flow_data(p_library_id)#-'{library,updated_at}')::text) then
 raise exception 'Script changed since this edit' using errcode='PT409'; end if;
 delete from public.library_asset_values v using public.library_assets a where a.library_id=p_library_id and v.asset_id=a.id
 and not exists(select 1 from jsonb_array_elements(h.before_data->'assets') r where r->>'id'=a.id::text and r->'propertyValues' ? v.field_id::text);
 delete from public.library_assets a where a.library_id=p_library_id and not exists(select 1 from jsonb_array_elements(h.before_data->'assets') r where r->>'id'=a.id::text);
 delete from public.library_field_definitions f where f.library_id=p_library_id and not exists(select 1 from jsonb_array_elements(h.before_data->'fields') r where r->>'id'=f.id::text);
 for row_data in select value from jsonb_array_elements(h.before_data->'assets') loop
   update public.library_assets set row_index=(row_data->>'rowIndex')::int where id=(row_data->>'id')::uuid and row_index is distinct from (row_data->>'rowIndex')::int;
   insert into public.library_asset_values(asset_id,field_id,value_json)
   select (row_data->>'id')::uuid,key::uuid,value from jsonb_each(row_data->'propertyValues')
   on conflict(asset_id,field_id) do update set value_json=excluded.value_json where public.library_asset_values.value_json is distinct from excluded.value_json;
 end loop;
 if h.before_data->'state'='null'::jsonb then delete from public.script_flow_states where library_id=p_library_id;
 else update public.script_flow_states set state=h.before_data->'state',updated_at=clock_timestamp() where library_id=p_library_id;end if;
 update public.libraries set plot_plan=nullif(h.before_data#>'{library,plot_plan}','null'::jsonb),updated_at=clock_timestamp() where id=p_library_id;
 delete from public.script_flow_undo where library_id=p_library_id and request_id=p_request_id;
end $$;
revoke all on function public.undo_script_flow(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.undo_script_flow(uuid,uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
