import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260720000000_document_derived_libraries.sql'
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('document-derived libraries migration', () => {
  it('adds paired ownership metadata and a source lookup index', () => {
    expect(sql).toMatch(/source_document_id uuid\s+references public\.documents\(id\) on delete cascade/i);
    expect(sql).toMatch(/document_export_type text/i);
    expect(sql).toMatch(/document_export_type in \('table', 'script'\)/i);
    expect(sql).toContain('idx_libraries_source_document_id');
    expect(sql).toContain('libraries_document_export_pair_check');
  });

  it('validates project and folder ownership and follows document moves', () => {
    expect(sql).toContain('enforce_derived_library_document');
    expect(sql).toContain('trg_libraries_derived_document');
    expect(sql).toContain('sync_derived_library_folder');
    expect(sql).toMatch(/after update of folder_id on public\.documents/i);
    expect(sql).toMatch(/update public\.libraries[\s\S]+source_document_id = new\.id/i);
  });

  it('keeps derived ownership metadata immutable after creation', () => {
    expect(sql).toMatch(/old\.source_document_id is not null/i);
    expect(sql).toMatch(/new\.source_document_id is distinct from old\.source_document_id/i);
    expect(sql).toMatch(/new\.document_export_type is distinct from old\.document_export_type/i);
  });

  it('locks source reads and prevents documents with derived libraries from changing projects', () => {
    expect(sql).toMatch(/where d\.id = new\.source_document_id\s+for share/i);
    expect(sql).toContain('prevent_derived_document_project_move');
    expect(sql).toMatch(/before update of project_id on public\.documents/i);
    expect(sql).toMatch(/exists[\s\S]+source_document_id = old\.id/i);
  });
});
