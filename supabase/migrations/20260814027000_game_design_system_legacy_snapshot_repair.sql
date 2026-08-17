-- Preserve a bounded legacy source excerpt for databases that ran the early backfill.

alter table public.game_design_system_versions
  disable trigger prevent_game_design_system_version_update;

update public.game_design_system_versions as version
set source_snapshots = (
  select jsonb_agg(
    case
      when snapshot ->> 'kind' = 'legacy_markdown'
        and snapshot ->> 'excerpt' is null
      then snapshot || jsonb_build_object(
        'excerpt', left(system.body, 20000),
        'truncated', character_length(system.body) > 20000
      )
      else snapshot
    end
    order by entry.ordinality
  )
  from jsonb_array_elements(version.source_snapshots)
    with ordinality as entry(snapshot, ordinality)
)
from public.game_design_systems as system
where system.id = version.system_id
  and exists (
    select 1
    from jsonb_array_elements(version.source_snapshots) as snapshot
    where snapshot ->> 'kind' = 'legacy_markdown'
      and snapshot ->> 'excerpt' is null
  );

alter table public.game_design_system_versions
  enable trigger prevent_game_design_system_version_update;

notify pgrst, 'reload schema';
