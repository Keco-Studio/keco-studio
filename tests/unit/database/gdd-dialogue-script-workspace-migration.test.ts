import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260820125000_add_gdd_dialogue_to_script_workspace.sql',
);

describe('GDD dialogue Script workspace migration', () => {
  it('adds every generated dialogue Document to its project Script workspace', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.sync_dialogue_document_to_script_workspace/i);
    expect(sql).toMatch(/insert\s+into\s+public\.script_workspace_documents/i);
    expect(sql).toMatch(/new\.project_id\s*,\s*new\.document_id/i);
    expect(sql).toMatch(/gdd_generation_jobs[\s\S]+owner_id/i);
    expect(sql).toMatch(/on\s+conflict\s*\(\s*project_id\s*,\s*document_id\s*\)\s+do\s+nothing/i);
    expect(sql).toMatch(/old\.document_id\s+is\s+distinct\s+from\s+new\.document_id/i);
    expect(sql).toMatch(/delete\s+from\s+public\.script_workspace_documents/i);
    expect(sql).toMatch(/source\s+Document.*project/i);
    expect(sql).toMatch(/after\s+insert[\s\S]+on\s+public\.dialogue_generation_jobs/i);
  });

  it('backfills Script workspace membership for existing dialogue jobs', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/insert\s+into\s+public\.script_workspace_documents[\s\S]+from\s+public\.dialogue_generation_jobs/i);
    expect(sql).toMatch(/on\s+conflict\s*\(\s*project_id\s*,\s*document_id\s*\)\s+do\s+nothing/i);
    expect(sql).toMatch(/join\s+public\.documents\s+as\s+source_document/i);
  });
});
