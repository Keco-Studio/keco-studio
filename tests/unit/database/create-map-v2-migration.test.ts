import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const migrationPath = path.join(process.cwd(), 'supabase/migrations/20260810020000_create_map_v2.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

describe('Create Map V2 migration', () => {
  it('allows only schema versions 1 and 2 with complete-or-empty source tuples', () => {
    expect(sql).toMatch(/map_revisions_schema_version_check[\s\S]+schema_version in \(1, 2\)/i);
    for (const column of ['source_document_id', 'source_document_updated_at', 'source_epoch', 'source_revision']) {
      expect(sql).toMatch(new RegExp(`alter column ${column} drop not null`, 'i'));
    }
    const tuple = sql.slice(sql.indexOf('add constraint map_revisions_source_tuple_check'));
    expect(tuple).toMatch(/schema_version = 1[\s\S]+source_document_id is not null[\s\S]+source_revision is not null/i);
    expect(tuple).toMatch(/schema_version = 2[\s\S]+source_document_id is null[\s\S]+source_revision is null/i);
    expect(tuple).toMatch(/schema_version = 2[\s\S]+source_document_id is not null[\s\S]+source_revision is not null/i);
  });

  it('keeps legacy asset kinds while adding V2 generation identity', () => {
    expect(sql).toMatch(/map_assets_kind_check[\s\S]+terrain[\s\S]+road[\s\S]+object[\s\S]+inpaint[\s\S]+path[\s\S]+obstacle[\s\S]+background/i);
    expect(sql).toMatch(/add column generation_id uuid/i);
    expect(sql).toMatch(/add column plan_fingerprint text[\s\S]+\^\[a-f0-9\]\{64\}\$/i);
  });

  it.each([
    ['create_map_project_v2', 'uuid, text, uuid, timestamptz, bigint, bigint, jsonb, jsonb'],
    ['save_map_draft_v2', 'uuid, uuid, bigint, jsonb, jsonb'],
    ['publish_map_revision_v2', 'uuid, uuid, bigint'],
    ['create_map_asset_plan_v2', 'uuid, uuid, text, text, text, text, jsonb, uuid[], text[], text, jsonb'],
  ])('defines and grants only the authenticated V2 RPC %s', (name, signature) => {
    expect(sql).toMatch(new RegExp(`create function public\\.${name}\\(`, 'i'));
    expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\(${escapeRegExp(signature)}\\) from public, anon`, 'i'));
    expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\(${escapeRegExp(signature)}\\) to authenticated`, 'i'));
  });

  it('guards V2 payloads and limits V2 asset plans to V2 kinds', () => {
    expect(sql).toMatch(/p_plan ->> 'schemaVersion' <> '2'/i);
    expect(sql).toMatch(/p_scene ->> 'schemaVersion' <> '2'/i);
    const assetPlan = sql.slice(sql.indexOf('create function public.create_map_asset_plan_v2'));
    expect(assetPlan).toMatch(/p_kind not in \('terrain', 'path', 'obstacle', 'background'\)/i);
    expect(assetPlan).toMatch(/p_generation_id is null[\s\S]+generation identity is required/i);
    expect(assetPlan).toMatch(/p_plan_fingerprint !~ '\^\[a-f0-9\]\{64\}\$'/i);
    expect(assetPlan).toMatch(/v_revision_status not in \('generating', 'partial', 'failed', 'ready'\)/i);
  });

  it('synchronizes summary name and timestamps and preserves nullable-source immutability', () => {
    const save = sql.slice(sql.indexOf('create function public.save_map_draft_v2'));
    expect(save).toMatch(/set name = btrim\(p_plan ->> 'name'\), updated_at = now\(\)/i);
    expect(sql).toMatch(/new\.source_document_id is distinct from old\.source_document_id/i);
    expect(sql).toMatch(/new\.source_revision is distinct from old\.source_revision/i);
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
