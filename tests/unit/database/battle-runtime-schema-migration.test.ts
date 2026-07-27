import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260727150000_battle_runtime_schema.sql'
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

const runtimeTables = [
  'skills',
  'job_classes',
  'job_class_skills',
  'player_saves',
  'battle_history',
  'enemy_templates',
  'map_enemies',
] as const;

describe('battle runtime schema migration', () => {
  it('creates all seven runtime tables with the application constraints', () => {
    for (const table of runtimeTables) {
      expect(sql).toMatch(
        new RegExp(`create table if not exists public\\.${table}\\s*\\(`, 'i')
      );
    }

    expect(sql).toMatch(/constraint player_saves_user_unique unique \(user_id\)/i);
    expect(sql).toMatch(/job_class_id text references public\.job_classes \(id\) on delete set null/i);
    expect(sql).toMatch(/job_class_id text not null references public\.job_classes \(id\) on delete cascade/i);
    expect(sql).toMatch(/skill_id text not null references public\.skills \(id\) on delete cascade/i);
    expect(sql).toMatch(/template_id text references public\.enemy_templates \(id\) on delete set null/i);
    expect(sql).toMatch(/constraint player_saves_level_positive check \(level >= 1\)/i);
    expect(sql).toMatch(/result text not null check \(result in \('win', 'lose'\)\)/i);
    expect(sql).toMatch(/battle_type text not null check \(battle_type in \('pve', 'pvp'\)\)/i);
    expect(sql).toMatch(/preferred_range text not null check \(preferred_range in \('melee', 'mid', 'ranged'\)\)/i);
    expect(sql).toMatch(/overrides jsonb/i);
  });

  it('creates the runtime lookup and uniqueness indexes', () => {
    for (const index of [
      'idx_skills_category',
      'idx_job_class_skills_skill',
      'idx_player_saves_user_id',
      'idx_player_saves_job_class',
      'uq_player_saves_character_name_ci',
      'idx_battle_history_user_id',
      'idx_battle_history_created',
      'idx_map_enemies_map_id',
    ]) {
      expect(sql).toMatch(new RegExp(`create (?:unique )?index if not exists ${index}`, 'i'));
    }
    expect(sql).toMatch(/uq_player_saves_character_name_ci[\s\S]+lower\(btrim\(character_name\)\)/i);
  });

  it('enables RLS and exposes static data as read-only', () => {
    for (const table of runtimeTables) {
      expect(sql).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`, 'i')
      );
    }

    for (const table of [
      'skills',
      'job_classes',
      'job_class_skills',
      'enemy_templates',
      'map_enemies',
    ]) {
      expect(sql).toMatch(
        new RegExp(`create policy ${table}_select_public[\\s\\S]+on public\\.${table}[\\s\\S]+for select[\\s\\S]+using \\(true\\)`, 'i')
      );
      expect(sql).toMatch(new RegExp(`grant select on public\\.${table} to anon, authenticated`, 'i'));
      expect(sql).toMatch(
        new RegExp(`revoke insert, update, delete on public\\.${table} from anon, authenticated`, 'i')
      );
    }
  });

  it('allows PVP reads while restricting save writes to the authenticated owner', () => {
    expect(sql).toMatch(/create policy player_saves_select_authenticated_pvp[\s\S]+for select[\s\S]+to authenticated[\s\S]+using \(true\)/i);
    for (const operation of ['insert', 'update', 'delete']) {
      expect(sql).toMatch(
        new RegExp(`create policy player_saves_${operation}_own[\\s\\S]+for ${operation}[\\s\\S]+auth\\.uid\\(\\) = user_id`, 'i')
      );
    }
    expect(sql).toMatch(/grant select, insert, update, delete on public\.player_saves to authenticated/i);
    expect(sql).toMatch(/grant all on public\.player_saves to service_role/i);
  });

  it('allows users to read and append only their own battle history', () => {
    expect(sql).toMatch(/create policy battle_history_select_own[\s\S]+for select[\s\S]+auth\.uid\(\) = user_id/i);
    expect(sql).toMatch(/create policy battle_history_insert_own[\s\S]+for insert[\s\S]+auth\.uid\(\) = user_id/i);
    expect(sql).toMatch(/grant select, insert on public\.battle_history to authenticated/i);
    expect(sql).toMatch(/revoke update, delete on public\.battle_history from anon, authenticated/i);
    expect(sql).toMatch(/grant all on public\.battle_history to service_role/i);
  });

  it('installs retry-safe update and new-user triggers', () => {
    for (const table of ['skills', 'player_saves', 'enemy_templates']) {
      expect(sql).toMatch(new RegExp(`drop trigger if exists trg_${table}_updated_at on public\\.${table}`, 'i'));
      expect(sql).toMatch(
        new RegExp(`create trigger trg_${table}_updated_at[\\s\\S]+before update on public\\.${table}[\\s\\S]+public\\.update_updated_at_column\\(\\)`, 'i')
      );
    }

    expect(sql).toMatch(/create or replace function public\.handle_new_user_save\(\)[\s\S]+security definer[\s\S]+set search_path = ''/i);
    expect(sql).toMatch(/insert into public\.player_saves \(user_id, character_name\)[\s\S]+new\.id, 'Adventurer-' \|\| new\.id::text/i);
    expect(sql).toMatch(/revoke all on function public\.handle_new_user_save\(\) from public, anon, authenticated/i);
    expect(sql).toMatch(/drop trigger if exists on_auth_user_created_save on auth\.users/i);
    expect(sql).toMatch(/create trigger on_auth_user_created_save[\s\S]+after insert on auth\.users[\s\S]+public\.handle_new_user_save\(\)/i);
  });

  it('backfills every existing auth user with one deterministic save', () => {
    expect(sql).toMatch(/insert into public\.player_saves \(user_id, character_name\)[\s\S]+select[\s\S]+users\.id[\s\S]+'Adventurer-' \|\| users\.id::text[\s\S]+from auth\.users as users[\s\S]+on conflict \(user_id\) do nothing/i);
  });

  it('seeds the stable battle catalogs and placements idempotently', () => {
    for (const sentinel of [
      "('arcane_bolt'",
      "('guardian_angel'",
      "('hero'",
      "('assassin'",
      "('mage', 'fireball'",
      "('guard-entity'",
      "('shadow-assassin'",
      "('default', 'enemy-1'",
      "('pixel-npc', 'instance-1776676384778-v05hce'",
    ]) {
      expect(sql).toContain(sentinel);
    }
    expect(sql.match(/on conflict/gi)?.length ?? 0).toBeGreaterThanOrEqual(10);
  });

  it('is transactional and reloads the PostgREST schema after all writes', () => {
    expect(sql).toMatch(/^\s*begin;/i);
    expect(sql).toMatch(/notify pgrst, 'reload schema';\s*commit;\s*$/i);
  });
});
