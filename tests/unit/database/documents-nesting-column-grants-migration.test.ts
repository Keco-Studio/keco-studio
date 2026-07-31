import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260731190000_documents_nesting_column_grants.sql'
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('documents nesting column grants migration', () => {
  it('grants parent_document_id and description write access to authenticated', () => {
    expect(sql).toMatch(/grant update \(name, folder_id, parent_document_id, description\)/i);
    expect(sql).toMatch(/grant insert \(project_id, folder_id, name, content, created_by, description\)/i);
    expect(sql).toMatch(/to authenticated/i);
  });
});
