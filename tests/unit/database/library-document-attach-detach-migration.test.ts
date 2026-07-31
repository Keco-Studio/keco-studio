import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260731170000_allow_library_document_attach_detach.sql'
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('library document attach/detach migration', () => {
  it('replaces enforce_derived_library_document to allow clear/set ownership', () => {
    expect(sql).toContain('create or replace function public.enforce_derived_library_document()');
    expect(sql).toMatch(/if new\.source_document_id is null then\s+return new;/i);
    expect(sql).not.toMatch(/Derived library source document cannot be changed/i);
    expect(sql).toMatch(/Derived library must follow the source document folder/i);
  });
});
