import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260731180000_nested_folders_documents.sql'
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('nested folders/documents migration', () => {
  it('adds parent columns, uniqueness, and nesting guards', () => {
    expect(sql).toContain('parent_folder_id');
    expect(sql).toContain('parent_document_id');
    expect(sql).toContain('enforce_folder_nesting');
    expect(sql).toContain('enforce_document_nesting');
    expect(sql).toContain('sync_nested_document_folder');
    expect(sql).toMatch(/maximum depth of %/i);
    expect(sql).toContain('idx_folders_project_root_name_unique');
    expect(sql).toContain('idx_folders_parent_name_unique');
  });
});
