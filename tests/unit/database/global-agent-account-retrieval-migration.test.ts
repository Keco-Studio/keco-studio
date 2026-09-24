import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260924140000_global_agent_account_retrieval.sql',
), 'utf8');

describe('global Agent account retrieval migration', () => {
  it('permits only owner-bound account chat chunks without a project', () => {
    expect(sql).toMatch(/alter table public\.agent_embedding_chunks\s+alter column project_id drop not null/i);
    expect(sql).toMatch(/project_id is not null\s+or \(source_type = 'chat_message' and user_id is not null and conversation_id is not null\)/i);
    expect(sql).toMatch(/project_id is null\s+and source_type = 'chat_message'\s+and user_id = auth\.uid\(\)/i);
    expect(sql).toMatch(/conversation\.id = conversation_id\s+and conversation\.user_id = auth\.uid\(\)\s+and conversation\.project_id is null/i);
    expect(sql).toMatch(/public\.user_has_project_access\(project_id, auth\.uid\(\)\)/i);
  });

  it('gates account RPC calls by owner and same-conversation scope', () => {
    expect(sql).toMatch(/auth\.uid\(\) is distinct from p_user_id/i);
    expect(sql).toMatch(/p_project_id is null[\s\S]+p_scope is distinct from 'chat_same_conversation'/i);
    expect(sql).toMatch(/conversation\.id = p_conversation_id\s+and conversation\.user_id = p_user_id\s+and conversation\.project_id is null/i);
    expect(sql).toMatch(/p_project_id is null\s+and c\.project_id is null\s+and c\.source_type = 'chat_message'\s+and c\.conversation_id = p_conversation_id\s+and c\.user_id = p_user_id/i);
    expect(sql).toMatch(/p_project_id is not null\s+and c\.project_id = p_project_id/i);
    expect(sql).toMatch(/user_has_project_access\(p_project_id, p_user_id\)/i);
    for (const scope of ['chat_same_conversation', 'chat_same_project', 'library', 'design_document', 'project_document']) {
      expect(sql).toContain(`p_scope = '${scope}'`);
    }
    expect(sql).toMatch(/grant execute on function public\.match_agent_embedding_chunks\([\s\S]+\) to authenticated, service_role/i);
  });
});
