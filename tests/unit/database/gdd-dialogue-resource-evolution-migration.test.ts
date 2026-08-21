import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260820130000_gdd_dialogue_resource_evolution.sql',
);

describe('GDD dialogue Script resource evolution migration', () => {
  it('uses stable script_table mappings and atomic lease/source fences', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/resource_kind\s*=\s*'script_table'/i);
    expect(sql).toMatch(/create or replace function public\.finalize_dialogue_script_import[\s\S]*returns table\(script_library_id uuid, action text\)/i);
    expect(sql).toMatch(/create or replace function public\.complete_dialogue_generation_job[\s\S]*returns table\(script_library_id uuid, action text\)/i);
    expect(sql).toMatch(/library_versions[\s\S]*'GDD Version '\s*\|\|[\s\S]*(current_revision\s*-\s*1|generation_revision\s*-\s*1)/i);
    expect(sql).toMatch(/delete from public\.libraries[\s\S]*v_staging\.id/i);
    expect(sql).toMatch(/lease_owner\s*=\s*p_worker_id[\s\S]*lease_expires_at\s*>=\s*now\(\)/i);
    expect(sql).toMatch(/collab_epoch[\s\S]*p_source_epoch[\s\S]*collab_revision[\s\S]*p_source_revision/i);
  });
});
