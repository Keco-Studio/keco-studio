-- Databases that already recorded the hierarchy migration expose its direct
-- implementation through v3. Fresh databases expose v5 directly. Add the
-- lock-safe v4 names without replacing a live Account page function.
do $migration$
begin
  if pg_catalog.to_regprocedure(
    'public.account_storage_project_entities_v4(uuid,text,text,integer,integer,uuid)'
  ) is null then
    if pg_catalog.to_regprocedure(
      'public.account_storage_project_entities_v5(uuid,text,text,integer,integer,uuid)'
    ) is not null then
      execute $function$
        create function public.account_storage_project_entities_v4(
          p_project_id uuid,
          p_query text default null,
          p_sort text default 'size_desc',
          p_limit integer default 50,
          p_offset integer default 0,
          p_parent_folder_id uuid default null
        )
        returns jsonb
        language sql
        security invoker
        set search_path = ''
        as $body$
          select public.account_storage_project_entities_v5(
            p_project_id,
            p_query,
            p_sort,
            p_limit,
            p_offset,
            p_parent_folder_id
          );
        $body$
      $function$;
    else
      execute $function$
        create function public.account_storage_project_entities_v4(
          p_project_id uuid,
          p_query text default null,
          p_sort text default 'size_desc',
          p_limit integer default 50,
          p_offset integer default 0,
          p_parent_folder_id uuid default null
        )
        returns jsonb
        language sql
        security invoker
        set search_path = ''
        as $body$
          select public.account_storage_project_entities_v3(
            p_project_id,
            p_query,
            p_sort,
            p_limit,
            p_offset,
            p_parent_folder_id
          );
        $body$
      $function$;
    end if;

    execute $permissions$
      revoke all on function public.account_storage_project_entities_v4(uuid, text, text, integer, integer, uuid)
        from public, anon, authenticated, service_role
    $permissions$;
    execute $permissions$
      grant execute on function public.account_storage_project_entities_v4(uuid, text, text, integer, integer, uuid)
        to authenticated
    $permissions$;
  end if;

  if pg_catalog.to_regprocedure(
    'public.account_storage_summary_v4()'
  ) is null then
    if pg_catalog.to_regprocedure('public.account_storage_summary_v5()') is not null then
      execute $function$
        create function public.account_storage_summary_v4()
        returns jsonb
        language sql
        security invoker
        set search_path = ''
        as $body$
          select public.account_storage_summary_v5();
        $body$
      $function$;
    else
      execute $function$
        create function public.account_storage_summary_v4()
        returns jsonb
        language sql
        security invoker
        set search_path = ''
        as $body$
          select public.account_storage_summary_v3();
        $body$
      $function$;
    end if;

    execute $permissions$
      revoke all on function public.account_storage_summary_v4()
        from public, anon, authenticated, service_role
    $permissions$;
    execute $permissions$
      grant execute on function public.account_storage_summary_v4()
        to authenticated
    $permissions$;
  end if;
end;
$migration$;
