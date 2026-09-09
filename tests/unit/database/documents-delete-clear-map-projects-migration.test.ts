import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('documents_delete_clear_map_projects migration', () => {
  const sql = readFileSync(
    path.join(
      process.cwd(),
      'supabase/migrations/20260909120000_documents_delete_clear_map_projects.sql'
    ),
    'utf8'
  );

  it('installs a before-delete trigger that removes dependent map projects', () => {
    expect(sql).toMatch(/create or replace function public\.documents_delete_dependent_map_projects/i);
    expect(sql).toMatch(/before delete on public\.documents/i);
    expect(sql).toMatch(/delete from public\.map_projects/i);
    expect(sql).toMatch(/source_document_id = old\.id/i);
  });
});
