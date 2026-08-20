-- Normalize rows from older workers before the strict table-resource RPC.
-- New workers already send { id, name, values }; this keeps retries and
-- rolling deployments compatible with older flat rows.

-- Repair partially applied environments where the previous compatibility
-- migration was skipped but the original RPC still exists.
do $$
begin
  if to_regprocedure('public.persist_completed_gdd_generation_job(uuid,text,text,text,text,jsonb,text[],text[],jsonb)') is not null
    and to_regprocedure('public.persist_completed_gdd_generation_job_strict(uuid,text,text,text,text,jsonb,text[],text[],jsonb)') is null then
    execute 'alter function public.persist_completed_gdd_generation_job(uuid,text,text,text,text,jsonb,text[],text[],jsonb) rename to persist_completed_gdd_generation_job_strict';
  end if;
end;
$$;

create or replace function public.persist_completed_gdd_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_markdown text,
  p_yjs_state text,
  p_description text,
  p_metadata jsonb,
  p_applied_rule_ids text[],
  p_omitted_rule_ids text[],
  p_table_resources jsonb default '[]'::jsonb
)
returns table(
  document_id uuid,
  document_name text,
  folder_id uuid,
  table_ids uuid[],
  table_names text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resources jsonb;
begin
  if p_table_resources is null or jsonb_typeof(p_table_resources) <> 'array' then
    v_resources := p_table_resources;
  else
    select coalesce(jsonb_agg(
      case
        when resource.value is not null and jsonb_typeof(resource.value) = 'object' then jsonb_build_object(
          'id', resource.value -> 'id',
          'table', resource.value -> 'table',
          'purpose', resource.value -> 'purpose',
          'fields', resource.value -> 'fields',
          'rows', case
            when jsonb_typeof(resource.value -> 'rows') = 'array' then (
              select coalesce(jsonb_agg(
                case
                  when legacy_row.value is not null and jsonb_typeof(legacy_row.value) = 'object' then jsonb_build_object(
                    'id', legacy_row.value -> 'id',
                    'name', legacy_row.value -> 'name',
                    'values', case
                      when jsonb_typeof(legacy_row.value -> 'values') = 'object'
                        then (legacy_row.value -> 'values') || (legacy_row.value - 'id' - 'name' - 'values')
                      else legacy_row.value - 'id' - 'name'
                    end
                  )
                  else legacy_row.value
                end
                order by legacy_row.ordinality
              ), '[]'::jsonb)
              from jsonb_array_elements(resource.value -> 'rows') with ordinality as legacy_row(value, ordinality)
            )
            else resource.value -> 'rows'
          end
        )
        else resource.value
      end
      order by resource.ordinality
    ), '[]'::jsonb)
    into v_resources
    from jsonb_array_elements(p_table_resources) with ordinality as resource(value, ordinality);
  end if;

  return query
  select persisted.document_id, persisted.document_name, persisted.folder_id,
         persisted.table_ids, persisted.table_names
  from public.persist_completed_gdd_generation_job_strict(
    p_job_id, p_worker_id, p_markdown, p_yjs_state, p_description,
    p_metadata, p_applied_rule_ids, p_omitted_rule_ids, v_resources
  ) as persisted;
end;
$$;

revoke all on function public.persist_completed_gdd_generation_job(
  uuid, text, text, text, text, jsonb, text[], text[], jsonb
) from public, anon, authenticated;
grant execute on function public.persist_completed_gdd_generation_job(
  uuid, text, text, text, text, jsonb, text[], text[], jsonb
) to service_role;

notify pgrst, 'reload schema';
