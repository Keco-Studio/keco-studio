import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261023180000_resolve_map_agent_handoff.sql'),
  'utf8',
);

describe('Map Agent handoff migration', () => {
  it('resumes an existing Agent conversation or binds one global GDS conversation once', () => {
    expect(migration).toContain('resolve_map_agent_handoff_v1');
    expect(migration).toContain('p_map_project_id uuid');
    expect(migration).toContain('p_plan_node_id uuid');
    expect(migration).toContain('public.map_require_writer(v_project_id)');
    expect(migration).toContain("'workspace', 'game-design-systems'");
    expect(migration).toContain('old.agent_conversation_id is null');
    expect(migration).toContain('grant execute on function public.resolve_map_agent_handoff_v1');
    expect(migration).not.toMatch(/drop table|truncate|delete from public\.map_/i);
  });
});
