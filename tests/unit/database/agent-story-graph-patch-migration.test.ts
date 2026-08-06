import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../../supabase/migrations/20260805120000_agent_story_graph_patch.sql'
  ),
  'utf8'
);

describe('Agent story graph patch migration', () => {
  it('defines one caller-scoped atomic patch function', () => {
    expect(migration).toMatch(/create or replace function public\.apply_story_graph_patch/i);
    expect(migration).toMatch(/language plpgsql[\s\S]+security invoker/i);
    expect(migration).not.toMatch(/security definer/i);
    expect(migration).toMatch(/v_user_id uuid := auth\.uid\(\)/i);
    expect(migration).toMatch(/is_project_owner/i);
    expect(migration).toMatch(/is_editor_or_admin_collaborator/i);
    expect(migration).toMatch(/for update/i);
  });

  it('checks the complete expected snapshot before mutation', () => {
    expect(migration).toMatch(/STORY_GRAPH_CONFLICT/i);
    expect(migration).toMatch(/libraryUpdatedAt/i);
    expect(migration).toMatch(/plotPlan/i);
    expect(migration).toMatch(/expected_snapshot -> 'fields'/i);
    expect(migration).toMatch(/expected_snapshot -> 'assets'/i);
    expect(migration).toMatch(/jsonb_agg/i);
  });

  it('updates fields, rows, values and plot plan in the same function', () => {
    expect(migration).toMatch(/insert into public\.library_field_definitions/i);
    expect(migration).toMatch(/__keco_flat_fields__/i);
    expect(migration).toMatch(/insert into public\.library_assets/i);
    expect(migration).toMatch(/insert into public\.library_asset_values/i);
    expect(migration).toMatch(/on conflict \(asset_id, field_id\)/i);
    expect(migration).toMatch(/plot_plan = p_plot_plan/i);
  });

  it('grants execution only to authenticated callers', () => {
    expect(migration).toMatch(/revoke all on function public\.apply_story_graph_patch[\s\S]+from public/i);
    expect(migration).toMatch(/grant execute on function public\.apply_story_graph_patch[\s\S]+to authenticated/i);
    expect(migration).not.toMatch(/grant execute on function public\.apply_story_graph_patch[\s\S]+to anon/i);
  });
});

