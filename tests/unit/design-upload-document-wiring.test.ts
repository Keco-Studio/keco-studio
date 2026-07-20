import fs from 'node:fs';
import path from 'node:path';

const page = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../src/app/(dashboard)/[projectId]/design-upload/page.tsx'
  ),
  'utf8'
);

describe('design upload durable document wiring', () => {
  it('delegates publication to the unified import service', () => {
    expect(page).toContain('createImportedDocument');
    expect(page).not.toContain("from '@/lib/services/documentService'");
    expect(page).not.toContain("from '@/lib/documents/documentStateGateway'");
    expect(page).not.toContain("from '@/lib/documents/documentContentCodec'");
  });

  it('passes the durable document id into the agent handoff', () => {
    expect(page).toContain('documentId: imported.document.id');
    expect(page).toContain('sourceDocumentId: imported.document.id');
    expect(page).toContain("exportType: 'table'");
  });

  it('allows only administrators to generate tables', () => {
    expect(page).toContain("const canGenerateTables = role === 'admin'");
    expect(page).toContain('Only administrators can generate tables from a design document.');
    expect(page).not.toContain("const isViewer = role === 'viewer'");
  });
});
