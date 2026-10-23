import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261023170000_bind_agent_conversations_to_map_versions.sql'),
  'utf8',
);

describe('Agent conversation Map bindings migration', () => {
  it('binds one durable Map version library to an Agent conversation', () => {
    expect(migration).toContain('agent_conversation_id uuid');
    expect(migration).toContain('read_agent_map_conversation_v1');
    expect(migration).toContain('attach_map_conversation_plan_to_agent_v1');
    expect(migration).toContain('follow-up Plan requires a base Plan');
    expect(migration).toContain('save_map_plan_v3');
    expect(migration).toContain('(project_id = p_project_id or project_id is null)');
    expect(migration).not.toMatch(/drop table|truncate|delete from public\.map_/i);
  });
});
