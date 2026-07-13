-- Retire the dead shared_documents table (superseded by public.documents,
-- GitHub #178/#180). Kept SEPARATE from documents creation so this destructive
-- step is reviewable and revertible on its own.
--
-- Safety contract (why this is not a bare `DROP TABLE ... CASCADE`):
--   * Historic analysis found no active application caller, but "no caller" does
--     not prove "no data" in production. We never drop blindly.
--   * Any surviving rows are archived into public.shared_documents_archive FIRST.
--   * The drop only proceeds once the archive row count matches the source; if
--     archiving is incomplete the migration RAISES and changes nothing.
--   * The archive table is left in place, so the table contents remain
--     recoverable after this migration runs.

do $$
declare
  v_exists boolean;
  v_row_count bigint := 0;
  v_archived bigint := 0;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'shared_documents'
  ) into v_exists;

  if not v_exists then
    raise notice 'shared_documents already absent; nothing to retire.';
    return;
  end if;

  execute 'select count(*) from public.shared_documents' into v_row_count;

  -- Archive surviving rows so the drop is reversible.
  if v_row_count > 0 then
    execute 'create table if not exists public.shared_documents_archive
             (like public.shared_documents including all)';
    execute 'insert into public.shared_documents_archive
             select * from public.shared_documents';
    execute 'select count(*) from public.shared_documents_archive' into v_archived;

    if v_archived < v_row_count then
      raise exception
        'Aborting shared_documents retirement: archived %/% rows.',
        v_archived, v_row_count;
    end if;

    execute $c$comment on table public.shared_documents_archive is
      'Frozen backup of shared_documents captured before retirement (2026-07-13). Drop once verified.'$c$;
    raise notice 'Archived % shared_documents rows before drop.', v_archived;
  end if;

  -- Remove from the realtime publication before dropping so no dangling
  -- publication entry is left behind.
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_documents'
  ) then
    execute 'alter publication supabase_realtime drop table public.shared_documents';
  end if;

  execute 'drop table public.shared_documents cascade';
  raise notice 'Dropped public.shared_documents (% row(s) archived).', v_archived;
end $$;
