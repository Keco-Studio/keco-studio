-- Project-scoped storage rows are detached by the project deletion outbox
-- (project_id is set to NULL) until the physical object has been removed and
-- its bytes settled. The FK can be exercised by maintenance clients that do
-- not call the outbox RPC first, so detached rows must be valid regardless of
-- lifecycle status. Preserve the one invariant that legacy rows never carry a
-- project id.
alter table public.project_storage_files
  drop constraint if exists project_storage_files_check;

alter table public.project_storage_files
  add constraint project_storage_files_check check (
    project_id is null
    or source_kind <> 'legacy_unassigned'
  );
