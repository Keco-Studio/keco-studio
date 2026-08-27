import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260827010000_character_animation_mcp.sql',
);

describe('character animation MCP migration', () => {
  it('creates project-owned character assets and durable generation attempts', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/create table public\.character_assets/i);
    expect(sql).toMatch(/project_id uuid not null references public\.projects\(id\) on delete cascade/i);
    expect(sql).toMatch(/kind text not null[\s\S]+character[\s\S]+animation/i);
    expect(sql).toMatch(/source_character_asset_id uuid references public\.character_assets\(id\)/i);
    expect(sql).toMatch(/create table public\.character_generation_attempts/i);
    expect(sql).toMatch(/generation_id uuid not null unique/i);
    expect(sql).toMatch(/attempt_count integer not null default 0/i);
    expect(sql).toMatch(/status in \('planned', 'queued', 'generating', 'ready', 'failed', 'blocked'\)/i);
  });

  it('strictly validates both plan variants and their bounded animation metadata', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const validator = functionBlock(sql, 'character_validate_asset_plan_v1', 'character_require_writer');

    expect(validator).toMatch(/p_plan - array\[[^\]]*'schemaVersion'[^\]]*'kind'[^\]]*'name'/i);
    expect(validator).toMatch(/kind' not in \('character', 'animation'\)/i);
    expect(validator).toMatch(/width[^\n]+in \(32, 64, 96, 128\)/i);
    expect(validator).toMatch(/height[^\n]+<>[^\n]+width/i);
    expect(validator).toMatch(/frameWidth[^\n]+between 16 and 256/i);
    expect(validator).toMatch(/frameWidth[^\n]+% 4/i);
    expect(validator).toMatch(/frameCount[^\n]+between 4 and 16/i);
    expect(validator).toMatch(/frameCount[^\n]+% 2[^\n]+<> 0/i);
    expect(validator).toMatch(/fps[^\n]+between 1 and 60/i);
    expect(validator).toMatch(/sourceCharacterSha256[\s\S]+\^\[a-f0-9\]\{64\}\$/i);
    expect(validator).toMatch(/https:\/\/|http:\/\//i);
    expect(validator).toMatch(/pixellab/i);
    expect(validator).toMatch(/animate_character/i);
    expect(sql).toMatch(/revoke all on function public\.character_validate_asset_plan_v1\(jsonb\)/i);
    expect(sql).not.toMatch(/grant execute on function public\.character_validate_asset_plan_v1/i);
  });

  it('provides writer-only idempotent draft, CAS update, and prepare RPCs', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    for (const name of [
      'create_character_asset_draft',
      'update_character_asset_draft',
      'prepare_character_asset_generation',
    ]) {
      expect(sql).toMatch(new RegExp(`create function public\\.${name}\\(`, 'i'));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]+to authenticated`, 'i'));
    }
    expect(functionBlock(sql, 'create_character_asset_draft', 'update_character_asset_draft'))
      .toMatch(/IDEMPOTENCY_CONFLICT[\s\S]+KM409/i);
    expect(functionBlock(sql, 'update_character_asset_draft', 'prepare_character_asset_generation'))
      .toMatch(/save_version = p_expected_save_version[\s\S]+status = 'draft'/i);
  });

  it('requires a same-project ready character with the exact source hash before animation prepare', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const prepare = functionBlock(sql, 'prepare_character_asset_generation', 'transition_character_generation');

    expect(prepare).toMatch(/source_character_asset_id[\s\S]+for update/i);
    expect(prepare).toMatch(/v_source\.project_id <> v_asset\.project_id/i);
    expect(prepare).toMatch(/v_source\.kind <> 'character'/i);
    expect(prepare).toMatch(/v_source\.status <> 'ready'/i);
    expect(prepare).toMatch(/sourceCharacterSha256[\s\S]+v_source_attempt\.sha256/i);
    expect(prepare).toMatch(/update public\.character_assets[\s\S]+set status = 'generating'/i);
  });

  it('uses an attempt-count CAS transition and requires complete ready metadata', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const transition = functionBlock(sql, 'transition_character_generation');

    expect(transition).toMatch(/for update/i);
    expect(transition).toMatch(/v_attempt\.attempt_count <> p_expected_attempt_count/i);
    expect(transition).toMatch(/v_next_attempt_count := v_attempt\.attempt_count[\s\S]+p_next_status = 'queued' then 1/i);
    expect(transition).toMatch(/p_next_status = 'ready'[\s\S]+p_storage_path is null[\s\S]+p_sha256 is null/i);
    expect(transition).toMatch(/update public\.character_assets[\s\S]+latest_generation_attempt_id/i);
    expect(sql).toMatch(/grant execute on function public\.transition_character_generation\([\s\S]+to service_role/i);
  });

  it('creates a private character bucket and expands atomic project cleanup', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/values \('character-assets', 'character-assets', false, 20971520, array\['image\/png'\]\)/i);
    expect(sql).toMatch(/create policy character_assets_storage_select/i);
    expect(sql).toMatch(/bucket_id = 'character-assets'/i);
    expect(sql).toMatch(/bucket_id in \('map-assets', 'character-assets'\)/i);
    expect(sql).toMatch(/insert into public\.project_storage_cleanup_jobs[\s\S]+'character-assets'/i);
    expect(sql).toMatch(/delete from public\.projects[\s\S]+return query/i);
  });

  it('keeps tables private while exposing read access through RLS', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/alter table public\.character_assets enable row level security/i);
    expect(sql).toMatch(/alter table public\.character_generation_attempts enable row level security/i);
    expect(sql).toMatch(/revoke all on public\.character_assets, public\.character_generation_attempts from public, anon, authenticated/i);
    expect(sql).toMatch(/grant select on public\.character_assets, public\.character_generation_attempts to authenticated/i);
  });
});

function functionBlock(sql: string, name: string, nextName?: string): string {
  const start = sql.indexOf(`create function public.${name}`);
  const end = nextName ? sql.indexOf(`create function public.${nextName}`, start + 1) : sql.length;
  return sql.slice(start, end);
}
