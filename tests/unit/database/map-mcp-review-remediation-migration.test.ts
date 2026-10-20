import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260821130000_map_mcp_review_remediation.sql',
);
const sql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

describe('Create Map MCP review remediation migration', () => {
  it('claims normalized intent before planning and completes it atomically', () => {
    expect(sql).toMatch(/create function public\.claim_map_project_v3_creation/i);
    expect(sql).toMatch(/p_intent_hash text/i);
    expect(sql).toMatch(/status[^;]+planning/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/create function public\.complete_map_project_v3_creation/i);
    expect(sql).toMatch(/from public\.create_map_project_v3\(/i);
    expect(sql).toMatch(/status = 'completed'/i);
    expect(sql).toMatch(/create function public\.release_map_project_v3_creation/i);
  });

  it('backfills legacy completed requests with an explicit project binding', () => {
    expect(sql).toMatch(
      /update public\.map_creation_requests[\s\S]+from public\.map_projects[\s\S]+request\.map_id/i,
    );
    expect(sql).toMatch(/alter column project_id set not null/i);
    expect(sql).toMatch(/drop function public\.create_map_project_v3_idempotent\(/i);
  });

  it('freezes the revision and creates its asset in one RPC transaction', () => {
    expect(sql).toMatch(/create function public\.prepare_map_generation_v3/i);
    expect(sql).toMatch(/from public\.publish_map_revision_v3\(/i);
    expect(sql).toMatch(/from public\.create_map_asset_plan_v3\(/i);
    expect(sql).toMatch(/generation identity conflict' using errcode = 'KM413'/i);
  });

  it('recovers an already frozen V3 revision that has no asset', () => {
    expect(sql).toMatch(/v_revision\.status = 'generating'/i);
    expect(sql).toMatch(/parent_revision_id = p_revision_id/i);
    expect(sql).toMatch(/not exists[\s\S]+from public\.map_assets/i);
  });

  it('keeps tables private and grants only RPC execution to authenticated users', () => {
    expect(sql).toMatch(/revoke all on table public\.map_creation_requests from public, anon, authenticated, service_role/i);
    for (const name of [
      'claim_map_project_v3_creation',
      'complete_map_project_v3_creation',
      'release_map_project_v3_creation',
      'prepare_map_generation_v3',
    ]) {
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\(`, 'i'));
    }
  });

  it('atomically rejects a paid submission when its confirmed attempt is stale', () => {
    expect(sql).toMatch(/create function public\.transition_map_asset_confirmed[\s\S]+p_expected_attempt_count integer/i);
    expect(sql).toMatch(/p_expected_attempt_count is null[\s\S]+v_asset\.attempt_count <> p_expected_attempt_count/i);
    expect(sql).toMatch(/return query select v_asset\.id, 'conflict'::text, v_asset\.attempt_count/i);
  });

  it('returns one newest RLS-readable GDS version for bounded page system IDs', () => {
    expect(sql).toMatch(/create function public\.list_latest_readable_game_design_system_versions\(\s*p_system_ids uuid\[\]\s*\)/i);
    expect(sql).toMatch(/security invoker/i);
    expect(sql).toMatch(/distinct on \(version\.system_id\)/i);
    expect(sql).toMatch(/version\.system_id = any/i);
    expect(sql).toMatch(/order by version\.system_id, version\.version_number desc, version\.id/i);
  });
});
