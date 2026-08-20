import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260820120000_gdd_resource_version_evolution.sql',
);

describe('GDD resource version evolution migration', () => {
  it('creates one stable resource series for each project and design system', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/create table if not exists public\.gdd_resource_series/i);
    expect(sql).toMatch(/project_id uuid not null references public\.projects\(id\)/i);
    expect(sql).toMatch(/design_system_id uuid not null references public\.game_design_systems\(id\)/i);
    expect(sql).toMatch(/folder_id uuid/i);
    expect(sql).toMatch(/primary_document_id uuid/i);
    expect(sql).toMatch(/gdd_resource_series_folder_project_fk[\s\S]*foreign key \(folder_id, project_id\)[\s\S]*references public\.folders\(id, project_id\)/i);
    expect(sql).toMatch(/gdd_resource_series_document_project_fk[\s\S]*foreign key \(primary_document_id, project_id\)[\s\S]*references public\.documents\(id, project_id\)/i);
    expect(sql).toMatch(/current_revision integer not null default 0/i);
    expect(sql).toMatch(/gdd_resource_series_current_revision_check check \(current_revision >= 0\)/i);
    expect(sql).toMatch(/constraint gdd_resource_series_project_design_system_key unique \(project_id, design_system_id\)/i);
  });

  it('tracks stable logical resources with exclusive document or library ownership', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/create table if not exists public\.gdd_series_resources/i);
    expect(sql).toMatch(/series_id uuid not null references public\.gdd_resource_series\(id\) on delete cascade/i);
    expect(sql).toMatch(/resource_kind text not null check \(resource_kind in \('gdd_document', 'table', 'dialogue_document', 'script_table'\)\)/i);
    expect(sql).toMatch(/logical_key text not null check \([\s\S]*logical_key = lower\(btrim\(logical_key\)\)[\s\S]*regexp_replace[\s\S]*char_length\(logical_key\) between 1 and 160/is);
    expect(sql).toMatch(/document_id uuid/i);
    expect(sql).toMatch(/library_id uuid/i);
    expect(sql).toMatch(/content_hash text not null check \(content_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
    expect(sql).toMatch(/constraint gdd_series_resources_series_kind_key unique \(series_id, resource_kind, logical_key\)/i);
    expect(sql).toMatch(/gdd_series_resources_ownership_check check \([\s\S]*resource_kind in \('gdd_document', 'dialogue_document'\)[\s\S]*document_id is not null[\s\S]*library_id is null[\s\S]*resource_kind in \('table', 'script_table'\)[\s\S]*document_id is null[\s\S]*library_id is not null/is);
    expect(sql).toMatch(/foreign key \(series_id, project_id, design_system_id\)[\s\S]*references public\.gdd_resource_series\(id, project_id, design_system_id\)/i);
    expect(sql).toMatch(/foreign key \(document_id, project_id\)[\s\S]*references public\.documents\(id, project_id\) on delete cascade/i);
    expect(sql).toMatch(/foreign key \(library_id, project_id\)[\s\S]*references public\.libraries\(id, project_id\) on delete cascade/i);
  });

  it('links generation jobs to a revisioned series and validates change summaries', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/alter table public\.gdd_generation_jobs[\s\S]*add column if not exists generation_series_id uuid/i);
    expect(sql).toMatch(/add column if not exists generation_revision integer/i);
    expect(sql).toMatch(/add column if not exists resource_change_summary jsonb not null default '\{"created": \[\], "updated": \[\], "reused": \[\], "preserved": \[\]\}'::jsonb/i);
    expect(sql).toMatch(/gdd_generation_jobs_generation_revision_check\s+check \(generation_revision is null or generation_revision >= 0\)/i);
    expect(sql).toMatch(/gdd_generation_jobs_resource_change_summary_check check \([\s\S]*jsonb_typeof\(resource_change_summary\) = 'object'[\s\S]*resource_change_summary \?& array\['created', 'updated', 'reused', 'preserved'\][\s\S]*jsonb_typeof\(resource_change_summary -> 'created'\) = 'array'[\s\S]*jsonb_typeof\(resource_change_summary -> 'updated'\) = 'array'[\s\S]*jsonb_typeof\(resource_change_summary -> 'reused'\) = 'array'[\s\S]*jsonb_typeof\(resource_change_summary -> 'preserved'\) = 'array'/is);
    expect(sql).toMatch(/foreign key \(generation_series_id, project_id, design_system_id\)[\s\S]*references public\.gdd_resource_series\(id, project_id, design_system_id\)/i);
  });

  it('allows generated resource snapshots in both version histories', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/drop constraint if exists document_versions_version_type_check/i);
    expect(sql).toMatch(/constraint document_versions_version_type_check check \([\s\S]*'gdd_generation'/is);
    expect(sql).toMatch(/drop constraint if exists library_versions_version_type_check/i);
    expect(sql).toMatch(/constraint library_versions_version_type_check check \(version_type in \('manual', 'restore', 'backup', 'gdd_generation'\)\)/i);
  });

  it('keeps resource-series tables service-role-only and updates timestamps', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    for (const table of ['gdd_resource_series', 'gdd_series_resources']) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`, 'i'));
      expect(sql).not.toMatch(new RegExp(`grant[\\s\\S]*on public\\.${table} to (?:anon|authenticated|public)`, 'i'));
      expect(sql).toMatch(new RegExp(`grant select, insert, update, delete on public\\.${table} to service_role`, 'i'));
      expect(sql).toMatch(new RegExp(`create trigger ${table}_updated_at[\\s\\S]*before update on public\\.${table}[\\s\\S]*execute function public\\.update_updated_at_column\\(\\)`, 'i'));
    }
  });

  it('evolves the canonical ten-argument persistence RPC around stable resource identities', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/drop function if exists public\.persist_completed_gdd_generation_job\([\s\S]*jsonb,\s*jsonb[\s\S]*\)/i);
    expect(sql).toMatch(/create function public\.persist_completed_gdd_generation_job\([\s\S]*p_dialogue_resources jsonb[\s\S]*returns table\([\s\S]*generation_revision integer,[\s\S]*resource_change_summary jsonb/is);
    expect(sql).toMatch(/insert into public\.gdd_resource_series[\s\S]*on conflict \(project_id, design_system_id\) do nothing/is);
    expect(sql).toMatch(/values \(v_job\.project_id, v_system_title, 'Generated GDD resources\.'\)/i);
    expect(sql).not.toMatch(/v_system_title \|\| ' GDD'.*Generated GDD resources/is);
    expect(sql).toMatch(/order by prior\.completed_at desc nulls last, prior\.created_at desc, prior\.id desc/i);
    expect(sql).toMatch(/primary_document_id/i);
    expect(sql).toMatch(/gdd_series_resources_series_kind_key/i);
    expect(sql).toMatch(/resource_kind = 'gdd_document'/i);
    expect(sql).toMatch(/resource_kind = 'table'/i);
    expect(sql).toMatch(/exception when others then raise exception 'Invalid generated table row ID'/i);
    expect(sql).toMatch(/cross join unnest\(prior\.output_table_ids, prior\.output_table_names\)/i);
    expect(sql).toMatch(/primary_document_id = v_document_id/i);
    expect(sql).toMatch(/extensions\.digest/i);
    expect(sql).toMatch(/'GDD Version ' \|\| v_series\.current_revision::text[\s\S]*'gdd_generation'/is);
    expect(sql).toMatch(/insert into public\.library_versions[\s\S]*'gdd_generation'/is);
    expect(sql).toMatch(/jsonb_build_object\([\s\S]*'library'[\s\S]*'schema'[\s\S]*'assets'/is);
    expect(sql).toMatch(/v_resource - 'id'/i);
    expect(sql).toMatch(/generation_revision = v_generation_revision/i);
    expect(sql).toMatch(/resource_change_summary = v_change_summary/i);
    expect(sql).toMatch(/collab_epoch = collab_epoch \+ 1[\s\S]*collab_revision = collab_revision \+ 1/is);
    expect(sql).toMatch(/for v_dialogue in select value from jsonb_array_elements\(p_dialogue_resources\)/i);
    expect(sql).toMatch(/resource_kind, logical_key, document_id, content_hash[\s\S]*'dialogue_document'/is);
    expect(sql).toMatch(/insert into public\.dialogue_generation_jobs/i);
    expect(sql).toMatch(/job\.status = 'completed'[\s\S]*generation_series_id is not null/is);
  });

  it('retains a nine-argument wrapper for rolling workers', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/create or replace function public\.persist_completed_gdd_generation_job\([\s\S]*p_table_resources jsonb[\s\S]*\)\s*returns table\(document_id uuid, document_name text, folder_id uuid, table_ids uuid\[\], table_names text\[\], generation_revision integer, resource_change_summary jsonb\)[\s\S]*p_table_resources, '\[\]'::jsonb/is);
    expect(sql).toMatch(/create function public\.persist_completed_gdd_generation_job\([\s\S]*p_omitted_rule_ids text\[\][\s\S]*\)\s*returns table\(document_id uuid, document_name text, folder_id uuid, table_ids uuid\[\], table_names text\[\], generation_revision integer, resource_change_summary jsonb\)/is);
  });

});
