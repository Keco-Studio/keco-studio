import { readFileSync } from 'node:fs';
import path from 'node:path';

const sql = readFileSync(path.resolve(
  __dirname,
  '../../../supabase/migrations/20260813100000_allow_viewer_script_workspace_import.sql'
), 'utf8');

describe('Script workspace viewer import migration', () => {
  it('allows owners and every accepted collaborator to insert membership', () => {
    expect(sql).toMatch(/drop policy if exists script_workspace_documents_insert/i);
    expect(sql).toMatch(/create policy script_workspace_documents_insert/i);
    expect(sql).toMatch(/is_project_owner/i);
    expect(sql).toMatch(/is_accepted_collaborator/i);
    expect(sql).not.toMatch(/is_editor_or_admin_collaborator/i);
  });

  it('does not widen workspace deletion', () => {
    expect(sql).not.toMatch(/script_workspace_documents_delete/i);
  });
});
