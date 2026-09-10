import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260910220000_slice_v2_project_asset_binding_gate.sql',
);
const sql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

describe('Slice V2 project Asset binding gate migration', () => {
  it('wraps the authenticated checkpoint RPC and hides the ungated core', () => {
    expect(sql).toMatch(/rename to mcp_checkpoint_slice_v2_asset_gate_core/i);
    expect(sql).toMatch(/revoke all on function public\.mcp_checkpoint_slice_v2_asset_gate_core[\s\S]*authenticated/i);
    expect(sql).toMatch(/create function public\.mcp_checkpoint_slice_v2\(/i);
    expect(sql).toMatch(/security definer set search_path = ''/i);
    expect(sql).toMatch(/grant execute on function public\.mcp_checkpoint_slice_v2[\s\S]*authenticated/i);
  });

  it('requires an exact unique binding set for every completed changed image', () => {
    expect(sql).toMatch(/count\(distinct artifact->>'artifactId'\)[\s\S]*jsonb_array_length\(coalesce\(p_artifacts/i);
    expect(sql).toMatch(/jsonb_array_length\(v_event->'payload'->'artifactIds'\)[\s\S]*v_image_count/i);
    expect(sql).toMatch(/artifact->>'artifactType' = 'project_asset_binding'/i);
    expect(sql).toMatch(/artifact->>'eventId' = v_event->>'eventId'/i);
    expect(sql).toMatch(/keco_slice_json_hash\(artifact->'payload'\)/i);
  });

  it('checks authoritative metadata and download/materialization hashes in the database', () => {
    expect(sql).toMatch(/from public\.project_game_assets/i);
    expect(sql).toMatch(/asset\.project_id = p_project_id/i);
    expect(sql).toMatch(/asset\.status = 'ready'/i);
    expect(sql).toMatch(/asset\.storage_path = artifact->'payload'->>'storagePath'/i);
    expect(sql).toMatch(/asset\.sha256 = substring\(artifact->'payload'->>'sha256' from 8\)/i);
    expect(sql).toMatch(/authoritativeDownloadSha256[\s\S]*materializedPath[\s\S]*materializedSha256/i);
  });
});
