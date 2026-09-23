-- Some databases applied the original 20260922180000 migration before its
-- RPCs were versioned. Give those databases the v3 names without replacing
-- live functions. A fresh migration exposes the direct implementation as v5;
-- older completed migrations may expose it as v4 or v2.
do $migration$
begin
  if pg_catalog.to_regprocedure(
    'public.account_storage_project_entities_v3(uuid,text,text,integer,integer,uuid)'
  ) is null then
    if pg_catalog.to_regprocedure(
      'public.account_storage_project_entities_v5(uuid,text,text,integer,integer,uuid)'
    ) is not null then
      execute $function$
        create function public.account_storage_project_entities_v3(
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
    elsif pg_catalog.to_regprocedure(
      'public.account_storage_project_entities_v4(uuid,text,text,integer,integer,uuid)'
    ) is not null then
      execute $function$
        create function public.account_storage_project_entities_v3(
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
          select public.account_storage_project_entities_v4(
            p_project_id,
            p_query,
            p_sort,
            p_limit,
            p_offset,
            p_parent_folder_id
          );
        $body$
      $function$;
    elsif pg_catalog.to_regprocedure(
      'public.account_storage_project_entities_v2(uuid,text,text,integer,integer,uuid)'
    ) is not null then
      execute $function$
        create function public.account_storage_project_entities_v3(
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
          select public.account_storage_project_entities_v2(
            p_project_id,
            p_query,
            p_sort,
            p_limit,
            p_offset,
            p_parent_folder_id
          );
        $body$
      $function$;
    elsif pg_catalog.to_regprocedure(
      'public.account_storage_project_entities(uuid,text,text,integer,integer,uuid)'
    ) is not null then
      execute $function$
        create function public.account_storage_project_entities_v3(
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
          select public.account_storage_project_entities(
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
      raise exception 'No Account Storage project entities implementation is available';
    end if;

    execute $permissions$
      revoke all on function public.account_storage_project_entities_v3(uuid, text, text, integer, integer, uuid)
        from public, anon, authenticated, service_role
    $permissions$;
    execute $permissions$
      grant execute on function public.account_storage_project_entities_v3(uuid, text, text, integer, integer, uuid)
        to authenticated
    $permissions$;
  end if;

  if pg_catalog.to_regprocedure(
    'public.account_storage_summary_v3()'
  ) is null then
    if pg_catalog.to_regprocedure('public.account_storage_summary_v5()') is not null then
      execute $function$
        create function public.account_storage_summary_v3()
        returns jsonb
        language sql
        security invoker
        set search_path = ''
        as $body$
          select public.account_storage_summary_v5();
        $body$
      $function$;
    elsif pg_catalog.to_regprocedure('public.account_storage_summary_v4()') is not null then
      execute $function$
        create function public.account_storage_summary_v3()
        returns jsonb
        language sql
        security invoker
        set search_path = ''
        as $body$
          select public.account_storage_summary_v4();
        $body$
      $function$;
    elsif pg_catalog.to_regprocedure('public.account_storage_summary_v2()') is not null then
      execute $function$
        create function public.account_storage_summary_v3()
        returns jsonb
        language sql
        security invoker
        set search_path = ''
        as $body$
          select public.account_storage_summary_v2();
        $body$
      $function$;
    elsif pg_catalog.to_regprocedure('public.account_storage_summary()') is not null then
      execute $function$
        create function public.account_storage_summary_v3()
        returns jsonb
        language sql
        security invoker
        set search_path = ''
        as $body$
          select public.account_storage_summary();
        $body$
      $function$;
    else
      raise exception 'No Account Storage summary implementation is available';
    end if;

    execute $permissions$
      revoke all on function public.account_storage_summary_v3()
        from public, anon, authenticated, service_role
    $permissions$;
    execute $permissions$
      grant execute on function public.account_storage_summary_v3()
        to authenticated
    $permissions$;
  end if;
end;
$migration$;
