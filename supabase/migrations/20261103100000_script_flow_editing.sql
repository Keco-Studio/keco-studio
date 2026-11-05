-- Trusted structure edits. Clients submit commands to the authenticated API,
-- never arbitrary value patches to these service-only functions.
create table public.script_flow_states (
  library_id uuid primary key references public.libraries(id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 1048576),
  updated_at timestamptz not null default now()
);
create table public.script_flow_requests (
  library_id uuid not null references public.libraries(id) on delete cascade,
  request_id uuid not null, actor_id uuid not null references auth.users(id) on delete cascade,
  request_hash text not null, result jsonb not null,
  primary key(library_id, request_id)
);
alter table public.script_flow_states enable row level security;
alter table public.script_flow_requests enable row level security;
revoke all on public.script_flow_states, public.script_flow_requests from anon, authenticated;
grant all on public.script_flow_states, public.script_flow_requests to service_role;

create function public.script_flow_data(p_library_id uuid) returns jsonb
language sql security definer set search_path = '' as $$
 select jsonb_build_object(
   'library', to_jsonb(l),
   'fields', coalesce((select jsonb_agg(to_jsonb(f) order by f.order_index, f.id) from public.library_field_definitions f where f.library_id=l.id),'[]'::jsonb),
   'assets', public.script_dialogue_origin_snapshot(l.id),
   'state', (select state from public.script_flow_states where library_id=l.id),
   'document', (select jsonb_build_object('id', d.id, 'epoch', d.collab_epoch, 'revision', d.collab_revision,
     'updates', coalesce((select jsonb_agg(u.id order by u.id) from public.document_yjs_updates u where u.document_id=d.id and u.epoch=d.collab_epoch),'[]'::jsonb))
     from public.documents d where d.id=l.source_document_id)
 ) from public.libraries l where l.id=p_library_id;
$$;
revoke all on function public.script_flow_data(uuid) from public, anon, authenticated;
grant execute on function public.script_flow_data(uuid) to service_role;

create function public.read_script_flow(p_project_id uuid, p_library_id uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_data jsonb;
begin
 if not (public.is_project_owner(p_project_id,p_actor) or public.is_accepted_collaborator(p_project_id,p_actor)) then
   raise exception 'Project access required' using errcode='42501';
 end if;
 v_data := public.script_flow_data(p_library_id);
 if v_data is null or v_data #>> '{library,project_id}' is distinct from p_project_id::text then
   raise exception 'Script not found' using errcode='P0002';
 end if;
 return jsonb_build_object('data',v_data,'fingerprint',md5(v_data::text), 'canEdit',
   public.is_project_owner(p_project_id,p_actor) or public.is_editor_or_admin_collaborator(p_project_id,p_actor));
end;
$$;
revoke all on function public.read_script_flow(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_script_flow(uuid,uuid,uuid) to service_role;

create function public.save_script_flow(p_project_id uuid,p_library_id uuid,p_actor uuid,p_expected text,
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
       or v_row#>>'{values,Commands}' is distinct from 'End' or v_row#>>'{values,Type}' is distinct from '4'
       or coalesce(v_row#>>'{values,Content}','')<>'' then
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
 insert into public.script_flow_states(library_id,state) values(p_library_id,p_state)
   on conflict(library_id) do update set state=excluded.state,updated_at=clock_timestamp();
 -- Stale plot edges must never override actual Script control flow.
 update public.libraries set updated_at=clock_timestamp() where id=p_library_id;
 update public.projects set updated_at=clock_timestamp() where id=p_project_id;
 v_result:=jsonb_build_object('libraryId',p_library_id,'requestId',p_request_id);
 insert into public.script_flow_requests values(p_library_id,p_request_id,p_actor,p_hash,v_result);
 return v_result;
end;
$$;
revoke all on function public.save_script_flow(uuid,uuid,uuid,text,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_script_flow(uuid,uuid,uuid,text,uuid,text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
