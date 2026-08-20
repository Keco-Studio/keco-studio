import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(process.cwd(), 'supabase/migrations/20260819100000_gdd_version_folder_table_resources.sql');
const rowsMigrationPath = path.join(process.cwd(), 'supabase/migrations/20260819110000_gdd_table_rows_and_system_folders.sql');
const compatibilityMigrationPath = path.join(process.cwd(), 'supabase/migrations/20260819130000_gdd_table_resource_compatibility.sql');
const rowCompatibilityMigrationPath = path.join(process.cwd(), 'supabase/migrations/20260819140000_gdd_table_row_compatibility.sql');
const nameCellMigrationPath = path.join(process.cwd(), 'supabase/migrations/20260819150000_backfill_gdd_name_cells.sql');

describe('GDD version folder and independent table resources migration', () => {
  it('binds generated folders and tables to one generation job', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/alter table public\.folders[\s\S]*gdd_generation_job_id uuid/i);
    expect(sql).toMatch(/alter table public\.libraries[\s\S]*gdd_generation_job_id uuid/i);
    expect(sql).toMatch(/folders_gdd_generation_job_idx/i);
  });

  it('creates or reuses a job folder and creates tables before the document', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const rpc = fs.readFileSync(rowsMigrationPath, 'utf8');
    expect(rpc).toMatch(/where folder\.gdd_generation_job_id = v_job\.id/i);
    expect(rpc).toMatch(/insert into public\.folders/i);
    expect(rpc).toMatch(/insert into public\.libraries/i);
    expect(rpc).toMatch(/insert into public\.library_field_definitions/i);
    expect(rpc).toMatch(/insert into public\.library_assets/i);
    expect(rpc).toMatch(/insert into public\.library_asset_values/i);
    expect(rpc.indexOf('insert into public.libraries')).toBeLessThan(rpc.indexOf('insert into public.documents'));
    expect(rpc).toMatch(/folder_id[\s\S]*v_folder_id/i);
  });

  it('names generated folders from the bound system title', () => {
    const sql = fs.readFileSync(rowsMigrationPath, 'utf8');
    expect(sql).toMatch(/v_system_title/i);
    expect(sql).toMatch(/systemTitle/i);
  });

  it('stores bounded public folder and table outputs on the job', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/output_folder_id uuid/i);
    expect(sql).toMatch(/output_table_ids uuid\[\]/i);
    expect(sql).toMatch(/output_table_names text\[\]/i);
    expect(sql).toMatch(/grant select \([\s\S]*output_folder_id[\s\S]*output_table_ids[\s\S]*output_table_names/i);
  });

  it('normalizes harmless resource metadata before strict persistence validation', () => {
    const sql = fs.readFileSync(compatibilityMigrationPath, 'utf8');
    expect(sql).toMatch(/rename to persist_completed_gdd_generation_job_strict/i);
    expect(sql).toMatch(/jsonb_build_object\([\s\S]*'id'[\s\S]*'table'[\s\S]*'purpose'[\s\S]*'fields'[\s\S]*'rows'/i);
    expect(sql).toMatch(/persist_completed_gdd_generation_job_strict\(/i);
  });

  it('normalizes flat legacy rows before strict persistence validation', () => {
    const sql = fs.readFileSync(rowCompatibilityMigrationPath, 'utf8');
    expect(sql).toMatch(/to_regprocedure\([\s\S]*persist_completed_gdd_generation_job_strict/i);
    expect(sql).toMatch(/rename to persist_completed_gdd_generation_job_strict/i);
    expect(sql).toMatch(/create or replace function public\.persist_completed_gdd_generation_job/i);
    expect(sql).toMatch(/'values'[\s\S]*row\.value -> 'values'/i);
    expect(sql).toMatch(/legacy_row\.value - 'id' - 'name'/i);
    expect(sql).toMatch(/persist_completed_gdd_generation_job_strict\(/i);
  });

  it('backfills generated name field cells from the durable row name', () => {
    const sql = fs.readFileSync(nameCellMigrationPath, 'utf8');
    expect(sql).toMatch(/update public\.library_asset_values/i);
    expect(sql).toMatch(/library\.gdd_generation_job_id is not null/i);
    expect(sql).toMatch(/to_jsonb\(asset\.name\)/i);
    expect(sql).toMatch(/value_json = 'null'::jsonb/i);
  });
});
