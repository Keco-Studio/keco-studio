import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260722221500_simulation_states.sql'
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('simulation states migration', () => {
  it('creates one constrained versioned snapshot per user and project', () => {
    expect(sql).toMatch(/create table public\.simulation_states/i);
    expect(sql).toMatch(/user_id uuid not null references auth\.users\(id\) on delete cascade/i);
    expect(sql).toMatch(/project_id uuid not null references public\.projects\(id\) on delete cascade/i);
    expect(sql).toMatch(/state_version integer not null/i);
    expect(sql).toMatch(/state jsonb not null/i);
    expect(sql).toMatch(/revision bigint not null/i);
    expect(sql).toMatch(/primary key \(user_id, project_id\)/i);
    expect(sql).toMatch(/state_version = 1/i);
    expect(sql).toMatch(/jsonb_typeof\(state\) = 'object'/i);
    expect(sql).toMatch(/revision >= 1/i);
    expect(sql).toMatch(
      /before update on public\.simulation_states[\s\S]+public\.update_updated_at_column\(\)/i
    );
  });

  it('requires the authenticated row identity and accepted project access in every policy', () => {
    expect(sql).toMatch(/alter table public\.simulation_states enable row level security/i);
    for (const operation of ['select', 'insert', 'update', 'delete']) {
      expect(sql).toMatch(
        new RegExp(
          `create policy simulation_states_${operation}_[\\s\\S]+?on public\\.simulation_states for ${operation}[\\s\\S]+?auth\\.uid\\(\\)[\\s\\S]+?user_id[\\s\\S]+?is_project_owner[\\s\\S]+?is_accepted_collaborator`,
          'i'
        )
      );
    }
    expect(sql).not.toContain('user_has_project_access');
  });

  it('allows authenticated direct reads but forces writes through RPCs', () => {
    expect(sql).toMatch(/grant select on public\.simulation_states to authenticated/i);
    expect(sql).toMatch(
      /revoke insert, update, delete on public\.simulation_states from authenticated/i
    );
    expect(sql).toMatch(
      /grant select, insert, update, delete on public\.simulation_states to service_role/i
    );
  });

  it('saves with an authenticated, validated compare-and-swap contract', () => {
    expect(sql).toMatch(
      /function public\.save_simulation_state\(\s*p_project_id uuid,\s*p_expected_revision bigint,\s*p_state_version integer,\s*p_state jsonb\s*\)/i
    );
    expect(sql).not.toMatch(/save_simulation_state\([\s\S]*?p_user_id/i);
    expect(sql).toMatch(/v_user_id uuid := \(select auth\.uid\(\)\)/i);
    expect(sql).toMatch(/p_expected_revision is null[\s\S]+p_expected_revision < 0/i);
    expect(sql).toMatch(/p_state_version <> 1/i);
    expect(sql).toMatch(/jsonb_typeof\(p_state\) <> 'object'/i);
    expect(sql).toMatch(/insert into public\.simulation_states[\s\S]+on conflict do nothing/i);
    expect(sql).toMatch(
      /update public\.simulation_states[\s\S]+revision = simulation_states\.revision \+ 1[\s\S]+user_id = v_user_id[\s\S]+project_id = p_project_id[\s\S]+simulation_states\.revision = p_expected_revision/i
    );
    expect(sql).toMatch(/return query select 'saved'::text, v_revision/i);
    expect(sql).toMatch(/return query select 'conflict'::text, null::bigint/i);
  });

  it('resets only the authenticated row at the expected revision', () => {
    expect(sql).toMatch(
      /function public\.reset_simulation_state\(\s*p_project_id uuid,\s*p_expected_revision bigint\s*\)/i
    );
    expect(sql).not.toMatch(/reset_simulation_state\([\s\S]*?p_user_id/i);
    expect(sql).toMatch(
      /delete from public\.simulation_states[\s\S]+user_id = v_user_id[\s\S]+project_id = p_project_id[\s\S]+simulation_states\.revision = p_expected_revision/i
    );
    expect(sql).toMatch(/p_expected_revision = 0[\s\S]+not exists/i);
    expect(sql).toMatch(/return query select 'reset'::text, null::bigint/i);
  });

  it('hardens both RPC definitions and exposes them only to authenticated callers', () => {
    expect(sql.match(/security definer\s+set search_path = ''/gi)).toHaveLength(2);
    expect(sql).toMatch(
      /revoke all on function public\.save_simulation_state\([\s\S]+?\) from public/i
    );
    expect(sql).toMatch(
      /revoke all on function public\.reset_simulation_state\([\s\S]+?\) from public/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.save_simulation_state\([\s\S]+?\) to authenticated/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.reset_simulation_state\([\s\S]+?\) to authenticated/i
    );
    expect(sql).toMatch(/notify pgrst, 'reload schema'/i);
  });
});
