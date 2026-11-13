import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20261113100000_project_template_instantiation.sql',
);

describe('project template instantiation migration', () => {
  it('stores one private state machine per owner request', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/create table public\.project_template_instantiations/i);
    expect(sql).toMatch(/unique\s*\(owner_id,\s*request_id\)/i);
    expect(sql).toMatch(/status text not null check\s*\(status in \('running',\s*'completed',\s*'failed'\)\)/i);
    expect(sql).toMatch(/alter table public\.project_template_instantiations enable row level security/i);
    expect(sql).toMatch(/revoke all on table public\.project_template_instantiations from public, anon, authenticated/i);
    expect(sql).not.toMatch(/grant [^;]+ on (?:table )?public\.project_template_instantiations to authenticated/i);
  });

  it('locks every mutation RPC to service role with a fixed search path', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const functions = [
      'claim_project_template_instantiation',
      'checkpoint_project_template_instantiation',
      'complete_project_template_instantiation',
      'fail_project_template_instantiation',
      'cleanup_project_template_instantiation',
    ];

    for (const name of functions) {
      expect(sql).toMatch(new RegExp(
        `create function public\\.${name}\\([\\s\\S]+?security definer[\\s\\S]+?set search_path = ''`,
        'i',
      ));
      expect(sql).toMatch(new RegExp(
        `revoke all on function public\\.${name}\\([\\s\\S]+?from public, anon, authenticated, service_role`,
        'i',
      ));
      expect(sql).toMatch(new RegExp(
        `grant execute on function public\\.${name}\\([\\s\\S]+?to service_role`,
        'i',
      ));
    }
  });

  it('claims atomically and cleans project storage before deleting an unbound GDS', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/insert into public\.project_template_instantiations[\s\S]+on conflict \(owner_id, request_id\) do nothing/i);
    expect(sql).toMatch(/from public\.project_template_instantiations[\s\S]+for update/i);
    expect(sql).toMatch(/template request conflicts with its original template/i);
    expect(sql).toMatch(/delete_project_and_enqueue_storage_cleanup\(v_row\.project_id\)/i);
    expect(sql).toMatch(/delete from public\.game_design_systems[\s\S]+id = v_row\.design_system_id/i);
    expect(sql).toMatch(/status = 'failed'[\s\S]+project_id = null[\s\S]+design_system_id = null/i);
  });
});
