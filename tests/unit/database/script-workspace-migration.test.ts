import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('script_workspace_documents migration', () => {
  const sql = readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260731200000_script_workspace_documents.sql'),
    'utf8'
  );

  it('creates table with composite PK and cascades', () => {
    expect(sql).toMatch(/create table[\s\S]*script_workspace_documents/i);
    expect(sql).toMatch(/primary key\s*\(\s*project_id\s*,\s*document_id\s*\)/i);
    expect(sql).toMatch(/references public\.documents\(id\) on delete cascade/i);
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toContain('is_editor_or_admin_collaborator');
    expect(sql).toContain('is_accepted_collaborator');
  });
});
