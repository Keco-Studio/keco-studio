-- Repair the initial compatibility backfill from the reusable legacy sections.

create function public.build_legacy_game_design_rule_set(
  p_genres text[],
  p_philosophies text[],
  p_suitable_for text,
  p_body text
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with lines as (
    select part.ordinality::integer as ordinal, btrim(part.line) as line
    from regexp_split_to_table(coalesce(p_body, ''), E'\r?\n')
      with ordinality as part(line, ordinality)
  ), candidates as (
    select
      line.ordinal,
      case
        when heading.line ~* 'Design Principles' then 'principle'
        else 'anti_pattern'
      end as kind,
      left(regexp_replace(line.line, '^[-*][[:space:]]+', ''), 800) as statement
    from lines as line
    cross join lateral (
      select previous.line
      from lines as previous
      where previous.ordinal < line.ordinal
        and previous.line ~ '^##[[:space:]]+'
      order by previous.ordinal desc
      limit 1
    ) as heading
    where line.line ~ '^[-*][[:space:]]+'
      and (
        heading.line ~* 'Design Principles'
        or heading.line ~* 'Anti-patterns'
      )
  ), prepared as (
    select
      candidate.*,
      btrim(left(regexp_replace(lower(candidate.statement), '[^a-z0-9]+', '-', 'g'), 64), '-') as raw_id,
      row_number() over (order by candidate.ordinal) as rule_number
    from candidates as candidate
    where candidate.statement <> ''
  ), based as (
    select
      prepared.*,
      case
        when prepared.raw_id ~ '^[a-z]' then prepared.raw_id
        when prepared.raw_id <> '' then 'legacy-' || prepared.raw_id
        else 'legacy-' || replace(prepared.kind, '_', '-') || '-' || prepared.rule_number
      end as base_id
    from prepared
  ), identified as (
    select
      based.*,
      row_number() over (partition by based.base_id order by based.ordinal) as duplicate_number
    from based
  ), metadata as (
    select
      coalesce((
        select jsonb_agg(btrim(item.value) order by item.ordinality)
        from unnest(coalesce(p_genres, '{}'::text[])) with ordinality as item(value, ordinality)
        where item.ordinality <= 20
      ), '[]'::jsonb) as genres,
      coalesce((
        select jsonb_agg(btrim(item.value) order by item.ordinality)
        from unnest(coalesce(p_philosophies, '{}'::text[])) with ordinality as item(value, ordinality)
        where item.ordinality <= 20
      ), '[]'::jsonb) as philosophies
  ), built as (
    select jsonb_build_object(
      'schemaVersion', 1,
      'genres', metadata.genres,
      'philosophies', metadata.philosophies,
      'suitableFor', coalesce(nullif(btrim(p_suitable_for), ''), 'Legacy projects requiring manual review'),
      'rules', jsonb_agg(jsonb_build_object(
        'id', case
          when identified.duplicate_number = 1 then identified.base_id
          else left(identified.base_id, 70) || '-' || identified.duplicate_number
        end,
        'kind', identified.kind,
        'title', left(identified.statement, 120),
        'statement', identified.statement,
        'appliesWhen', 'Reviewing game design work governed by this legacy system.',
        'severity', case when identified.kind = 'principle' then 'recommended' else 'warning' end
      ) order by identified.ordinal),
      'tableGuidance', '[]'::jsonb
    ) as rules
    from identified
    cross join metadata
    group by metadata.genres, metadata.philosophies
  )
  select built.rules
  from built
  where (select count(*) from identified) between 1 and 80
    and character_length(coalesce(nullif(btrim(p_suitable_for), ''), 'Legacy projects requiring manual review')) <= 500
    and not exists (
      select 1
      from unnest(coalesce(p_genres, '{}'::text[])) with ordinality as item(value, ordinality)
      where item.ordinality <= 20
        and (btrim(item.value) = '' or character_length(btrim(item.value)) > 80)
    )
    and not exists (
      select 1
      from unnest(coalesce(p_philosophies, '{}'::text[])) with ordinality as item(value, ordinality)
      where item.ordinality <= 20
        and (btrim(item.value) = '' or character_length(btrim(item.value)) > 120)
    )
    and pg_catalog.octet_length(built.rules::text) <= 65536;
$$;

create function public.render_legacy_game_design_rule_set(
  p_title text,
  p_rules jsonb
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  rendered text;
  genres text;
  philosophies text;
  section record;
  rule record;
begin
  select string_agg(value, ', ') into genres
  from jsonb_array_elements_text(p_rules -> 'genres');
  select string_agg(value, ', ') into philosophies
  from jsonb_array_elements_text(p_rules -> 'philosophies');

  rendered := '# ' || btrim(p_title)
    || E'\n\n> Version: 1'
    || E'\n> Genre: ' || coalesce(nullif(genres, ''), 'Unspecified')
    || E'\n> Design Philosophy: ' || coalesce(nullif(philosophies, ''), 'Unspecified')
    || E'\n> Suitable For: ' || (p_rules ->> 'suitableFor');

  for section in
    select * from (values
      (1, 'principle', 'Principles'),
      (2, 'constraint', 'Constraints'),
      (3, 'pattern', 'Patterns'),
      (4, 'anti_pattern', 'Anti-patterns'),
      (5, 'check', 'Checks')
    ) as sections(rank, kind, heading)
    order by rank
  loop
    if exists (
      select 1 from jsonb_array_elements(p_rules -> 'rules') as item
      where item ->> 'kind' = section.kind
    ) then
      rendered := rendered || E'\n\n## ' || section.heading;
      for rule in
        select item
        from jsonb_array_elements(p_rules -> 'rules') with ordinality as entry(item, ordinal)
        where item ->> 'kind' = section.kind
        order by ordinal
      loop
        rendered := rendered
          || E'\n\n### ' || (rule.item ->> 'id') || ' - ' || (rule.item ->> 'title')
          || E'\n\n' || (rule.item ->> 'statement')
          || E'\n\n- Severity: ' || (rule.item ->> 'severity')
          || E'\n- Applies when: ' || (rule.item ->> 'appliesWhen');
      end loop;
    end if;
  end loop;

  return rendered || E'\n\n## Keco Table Guidance\n\nNo table guidance specified.\n';
end;
$$;

alter table public.game_design_system_versions
  disable trigger prevent_game_design_system_version_update;

with migrated as materialized (
  select
    version.id,
    system.title,
    version.rendered_markdown as original_markdown,
    public.build_legacy_game_design_rule_set(
      system.genres,
      system.philosophies,
      system.suitable_for,
      version.rendered_markdown
    ) as rules
  from public.game_design_system_versions as version
  join public.game_design_systems as system on system.id = version.system_id
  where version.version_number = 1
    and exists (
      select 1
      from jsonb_array_elements(version.source_snapshots) as snapshot
      where snapshot ->> 'kind' = 'legacy_markdown'
    )
)
update public.game_design_system_versions as version
set rules = migrated.rules,
    rendered_markdown = public.render_legacy_game_design_rule_set(migrated.title, migrated.rules),
    diff = jsonb_build_object(
      'added', (
        select coalesce(jsonb_agg(rule ->> 'id' order by rule ->> 'id'), '[]'::jsonb)
        from jsonb_array_elements(migrated.rules -> 'rules') as rule
      ),
      'removed', '[]'::jsonb,
      'changed', '[]'::jsonb,
      'conflicts', '[]'::jsonb
    ),
    conflicts = '[]'::jsonb,
    source_snapshots = (
      select jsonb_agg(
        case when snapshot ->> 'kind' = 'legacy_markdown'
          then snapshot || jsonb_build_object(
            'excerpt', left(migrated.original_markdown, 20000),
            'truncated', character_length(migrated.original_markdown) > 20000
          )
          else snapshot
        end
      )
      from jsonb_array_elements(version.source_snapshots) as snapshot
    ),
    content_hash = encode(digest(convert_to(migrated.rules::text, 'UTF8'), 'sha256'), 'hex')
from migrated
where version.id = migrated.id
  and migrated.rules is not null;

alter table public.game_design_system_versions
  enable trigger prevent_game_design_system_version_update;

update public.game_design_systems as system
set migration_status = case
      when public.build_legacy_game_design_rule_set(
        system.genres,
        system.philosophies,
        system.suitable_for,
        system.body
      ) is null then 'needs_migration'
      else 'ready'
    end
from public.game_design_system_versions as legacy
join public.game_design_system_versions as version
  on version.id = legacy.id
where legacy.system_id = system.id
  and legacy.version_number = 1
  and exists (
    select 1
    from jsonb_array_elements(legacy.source_snapshots) as snapshot
    where snapshot ->> 'kind' = 'legacy_markdown'
  );

delete from public.project_game_design_systems as binding
using public.game_design_systems as system
where binding.design_system_id = system.id
  and system.migration_status = 'needs_migration';

create or replace function public.enforce_game_design_system_binding_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.game_design_system_versions as version
    join public.game_design_systems as system on system.id = version.system_id
    where version.id = new.version_id
      and version.system_id = new.design_system_id
      and jsonb_array_length(version.conflicts) = 0
      and system.migration_status = 'ready'
  ) then
    raise exception 'Version does not belong to system, has unresolved conflicts, or needs migration'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop function public.render_legacy_game_design_rule_set(text, jsonb);
drop function public.build_legacy_game_design_rule_set(text[], text[], text, text);

notify pgrst, 'reload schema';
