-- Prevent legacy GDD table backfills from aborting generation when an old
-- library id is already associated with a different stable resource key.
--
-- gdd_series_resources.library_id is intentionally globally unique: one
-- library must have one durable resource identity. Older completed jobs can,
-- however, contain the same library id under more than one historical table
-- name. The resource-evolution RPC uses ON CONFLICT on the logical key, so a
-- library-id conflict would otherwise surface as an uncaught 23505 while it
-- bootstraps those legacy rows. Keep the first durable mapping and ignore the
-- incompatible alias; current generation resources are materialized separately
-- and will be persisted normally.

create or replace function public.gdd_series_resources_skip_library_alias()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Generation runs for different projects do not share the RPC's
  -- project-scoped advisory lock. Serialize by the globally unique library
  -- id so two legacy backfills cannot both pass the check before either row
  -- becomes visible, which would still raise 23505 at the unique index.
  if new.resource_kind = 'table' and new.library_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.library_id::text, 0)
    );
  end if;

  if new.resource_kind = 'table' and new.library_id is not null then
    -- Historical output arrays can also contain a library from another
    -- project. Ignore that alias before the composite ownership FK rejects it.
    if exists (
      select 1
      from public.libraries as library
      where library.id = new.library_id
        and library.project_id <> new.project_id
    ) or exists (
      select 1
      from public.gdd_series_resources as existing
      where existing.library_id = new.library_id
        and not (
          existing.series_id = new.series_id
          and existing.resource_kind = new.resource_kind
          and existing.logical_key = new.logical_key
        )
    ) then
      if tg_op = 'UPDATE' then
        return old;
      end if;
      return null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists gdd_series_resources_skip_library_alias on public.gdd_series_resources;
create trigger gdd_series_resources_skip_library_alias
  before insert or update on public.gdd_series_resources
  for each row
  execute function public.gdd_series_resources_skip_library_alias();

revoke all on function public.gdd_series_resources_skip_library_alias() from public, anon, authenticated;
grant execute on function public.gdd_series_resources_skip_library_alias() to service_role;
