import fs from 'node:fs';
import path from 'node:path';

const sqlPath = path.join(
  process.cwd(),
  'supabase/migrations/20260914100000_gdd_async_resource_reference_writeback.sql',
);
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf8') : '';

describe('GDD async resource reference writeback migration', () => {
  it('atomically persists map artifacts and their document references', () => {
    expect(sql).toMatch(/create or replace function public\.materialize_gdd_map_artifacts/i);
    expect(sql).toMatch(/assert_document_snapshot_payload/i);
    expect(sql).toMatch(/p_expected_markdown/i);
    expect(sql).toMatch(/insert into public\.gdd_map_artifacts/i);
    expect(sql).toMatch(/update public\.documents/i);
    expect(sql).toMatch(/job\.status in \('completed', 'completed_with_map_failures'\)/i);
    expect(sql).toMatch(/output_document_id is distinct from p_document_id/i);
    expect(sql).toMatch(/v_document\.content is distinct from p_expected_markdown/i);
    expect(sql).toMatch(/from public\.document_yjs_updates/i);
    expect(sql).toMatch(/collab_epoch = document\.collab_epoch \+ 1/i);
    expect(sql).toMatch(/collab_revision = document\.collab_revision \+ 1/i);
  });

  it('keeps the writeback operation service-role-only', () => {
    expect(sql).toMatch(/revoke all on function public\.materialize_gdd_map_artifacts[\s\S]*authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.materialize_gdd_map_artifacts[\s\S]*service_role/i);
  });

  it('protects independent table and dialogue writebacks from stale snapshots', () => {
    expect(sql).toMatch(/create or replace function public\.materialize_gdd_resource_payload/i);
    expect(sql).toMatch(/p_expected_markdown/i);
    expect(sql).toMatch(/v_document\.content is distinct from p_expected_markdown/i);
    expect(sql).toMatch(/from public\.document_yjs_updates/i);
    expect(sql).toMatch(/p_table_resources/i);
    expect(sql).toMatch(/p_dialogue_resources/i);
    expect(sql).toMatch(/revoke all on function public\.materialize_gdd_resource_payload[\s\S]*authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.materialize_gdd_resource_payload[\s\S]*service_role/i);
  });
});
