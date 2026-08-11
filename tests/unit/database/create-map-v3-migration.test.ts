import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const migrationPath = path.join(process.cwd(), 'supabase/migrations/20260811020000_create_map_v3_direct_image.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

describe('Create Map V3 direct-image migration', () => {
  it('adds schema 3 and the map_image kind without dropping legacy values', () => {
    expect(sql).toMatch(/schema_version in \(1, 2, 3\)/i);
    expect(sql).toMatch(/schema_version in \(2, 3\)[\s\S]+source_document_id is null[\s\S]+source_revision is null/i);
    expect(sql).toMatch(/map_assets_kind_check[\s\S]+terrain[\s\S]+road[\s\S]+object[\s\S]+inpaint[\s\S]+path[\s\S]+obstacle[\s\S]+background[\s\S]+map_image/i);
  });

  it('defines a private project-scoped reference registry', () => {
    expect(sql).toMatch(/create table public\.map_reference_images/i);
    expect(sql).toMatch(/project_id uuid not null references public\.projects\(id\) on delete cascade/i);
    expect(sql).toMatch(/storage_path text not null unique/i);
    expect(sql).toMatch(/sha256 text not null check \(sha256 ~ '\^\[a-f0-9\]\{64\}\$'\)/i);
    expect(sql).toMatch(/content_type text not null check \(content_type = 'image\/png'\)/i);
    expect(sql).toMatch(/byte_size integer not null check \(byte_size > 0 and byte_size <= 5242880\)/i);
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/map_reference_images_select/i);
    expect(sql).toMatch(/revoke all on public\.map_reference_images from public, anon, authenticated/i);
    expect(sql).toMatch(/grant select on public\.map_reference_images to authenticated/i);
  });

  it.each([
    ['create_map_project_v3', 'uuid, text, uuid, timestamptz, bigint, bigint, jsonb, jsonb'],
    ['save_map_draft_v3', 'uuid, uuid, bigint, jsonb, jsonb'],
    ['publish_map_revision_v3', 'uuid, uuid, bigint'],
    ['create_map_asset_plan_v3', 'uuid, uuid, text'],
  ])('defines and grants authenticated RPC %s', (name, signature) => {
    expect(sql).toMatch(new RegExp(`create function public\\.${name}\\(`, 'i'));
    expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\(${escapeRegExp(signature)}\\) from public, anon`, 'i'));
    expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\(${escapeRegExp(signature)}\\) to authenticated`, 'i'));
  });

  it('keeps the V3 validator private and enforces the direct-image payload contract', () => {
    const validator = sql.slice(sql.indexOf('create function public.map_validate_v3_payload'));
    expect(validator).toMatch(/jsonb_typeof\(p_plan\) <> 'object'[\s\S]+jsonb_typeof\(p_scene\) <> 'object'/i);
    expect(validator).toMatch(/jsonb_typeof\(p_plan -> 'schemaVersion'\) is distinct from 'number'[\s\S]+jsonb_typeof\(p_scene -> 'schemaVersion'\) is distinct from 'number'/i);
    expect(validator).toMatch(/p_plan ->> 'schemaVersion' <> '3'[\s\S]+p_scene ->> 'schemaVersion' <> '3'/i);
    expect(validator).toMatch(/\(512, 512\)[\s\S]+\(688, 384\)[\s\S]+\(384, 688\)/i);
    expect(validator).toMatch(/char_length\(p_plan ->> 'description'\) between 1 and 2000/i);
    for (const unsafeToken of ['https:', 'http:', 'www', 'data:', 'authorization', 'bearer', 'password', 'token', 'create_image_pro', 'get_image', 'pixellab', 'mcp']) {
      expect(validator).toMatch(new RegExp(unsafeToken, 'i'));
    }
    expect(validator).toMatch(/user\\s\+interface/i);
    expect(validator).toMatch(/p_plan #>> '\{generation,provider\}' <> 'pixellab'/i);
    expect(validator).toMatch(/p_plan #>> '\{generation,operation\}' <> 'create_image_pro'/i);
    expect(validator).toMatch(/p_plan #> '\{generation,noBackground\}' <> 'false'::jsonb/i);
    expect(validator).toMatch(/jsonb_array_length\(p_plan -> 'references'\) > 4/i);
    expect(validator).toMatch(/jsonb_typeof\(p_plan #> '\{styleReference,copy\}'\) is distinct from 'array' then[\s\S]+raise exception 'invalid V3 style reference'[\s\S]+end if;[\s\S]+jsonb_array_length\(p_plan #> '\{styleReference,copy\}'\)/i);
    expect(validator).toMatch(/count\(distinct copied\.value\)[\s\S]+jsonb_array_length\(p_plan #> '\{styleReference,copy\}'\)/i);
    expect(validator).toMatch(/p_scene #>> '\{size,width\}'[\s\S]+p_plan #>> '\{map,width\}'/i);
    expect(sql).toMatch(/revoke all on function public\.map_validate_v3_payload\(jsonb, jsonb\) from public, anon, authenticated/i);
    expect(sql).not.toMatch(/grant execute on function public\.map_validate_v3_payload/i);
  });

  it('uses V3-only revision lookups and preserves CAS publish semantics', () => {
    const create = functionBlock('create_map_project_v3', 'save_map_draft_v3');
    const save = functionBlock('save_map_draft_v3', 'publish_map_revision_v3');
    const publish = functionBlock('publish_map_revision_v3', 'create_map_asset_plan_v3');
    expect(create).toMatch(/3, p_plan, p_scene, 'draft'/i);
    expect(save).toMatch(/revision\.schema_version = 3/i);
    expect(save).toMatch(/revision\.save_version = p_expected_save_version/i);
    expect(publish).toMatch(/schema_version = 3/i);
    expect(publish).toMatch(/from public\.map_revisions as revision[\s\S]+where revision\.map_project_id = p_map_id and revision\.schema_version = 3/i);
    expect(publish).toMatch(/set status = 'generating'/i);
    expect(publish).toMatch(/v_draft\.source_revision, 3,[\s\S]+v_draft\.plan, v_draft\.scene, 'draft'/i);
    expect(publish).toMatch(/set current_revision_id = v_next_revision_id/i);
  });

  it('locks map projects before locking or updating V3 revisions', () => {
    const save = functionBlock('save_map_draft_v3', 'publish_map_revision_v3');
    const publish = functionBlock('publish_map_revision_v3', 'create_map_asset_plan_v3');
    expect(save).toMatch(/select \* into v_map from public\.map_projects where id = p_map_id for update;[\s\S]+update public\.map_revisions as revision/i);
    expect(publish).toMatch(/select \* into v_map from public\.map_projects where id = p_map_id for update;[\s\S]+from public\.map_revisions[\s\S]+for update;/i);
  });

  it('derives one immutable direct-image asset plan and verifies ordered registry references', () => {
    const assetPlan = functionBlock('create_map_asset_plan_v3');
    expect(assetPlan).toMatch(/v_asset_key\s*:=\s*'map-image'/i);
    expect(assetPlan).toMatch(/v_kind\s*:=\s*'map_image'/i);
    expect(assetPlan).toMatch(/v_capability\s*:=\s*'direct_map_image'/i);
    expect(assetPlan).toMatch(/v_prompt\s*:=\s*v_revision\.plan ->> 'description'/i);
    expect(assetPlan).toMatch(/'references', coalesce\(v_revision\.plan -> 'references', '\[\]'::jsonb\)/i);
    expect(assetPlan).toMatch(/'styleReference', v_revision\.plan -> 'styleReference'/i);
    expect(assetPlan).toMatch(/with ordinality/i);
    expect(assetPlan).toMatch(/duplicate reference assets/i);
    expect(assetPlan).toMatch(/reference id and hash counts differ/i);
    expect(assetPlan).toMatch(/reference image not found/i);
    expect(assetPlan).toMatch(/reference image belongs to another project/i);
    expect(assetPlan).toMatch(/reference image sha256 mismatch/i);
    for (const field of ['generation_id', 'kind', 'prompt', 'generation_params', 'reference_asset_ids', 'reference_hashes', 'plan_fingerprint']) {
      expect(assetPlan).toMatch(new RegExp(`v_asset\\.${field}`, 'i'));
    }
  });
});

function functionBlock(name: string, nextName?: string): string {
  const start = sql.indexOf(`create function public.${name}`);
  const end = nextName ? sql.indexOf(`create function public.${nextName}`, start + 1) : sql.length;
  return sql.slice(start, end);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
