import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentSummary } from '@/lib/services/documentService';

const listDocuments = jest.fn();
const listProjectFolders = jest.fn();

jest.mock('@/lib/services/documentService', () => ({ listDocuments }));
jest.mock('@/lib/agent/data-access', () => ({ listProjectFolders }));

import {
  listResolvedProjectDocuments,
  resolveDocumentForTool,
} from '@/lib/agent/document-resolver';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const GUIDE_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_GUIDE_ID = '33333333-3333-4333-8333-333333333333';
const NOTES_ID = '44444444-4444-4444-8444-444444444444';
const MISSING_ID = '55555555-5555-4555-8555-555555555555';
const LORE_FOLDER_ID = '66666666-6666-4666-8666-666666666666';
const DESIGN_FOLDER_ID = '77777777-7777-4777-8777-777777777777';

const supabase = {} as SupabaseClient;

function document(
  id: string,
  name: string,
  folderId: string | null,
  updatedAt: string
): DocumentSummary {
  return {
    id,
    project_id: PROJECT_ID,
    folder_id: folderId,
    name,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: updatedAt,
  };
}

const rows = [
  document(GUIDE_ID, 'Guide', LORE_FOLDER_ID, '2026-07-10T00:00:00.000Z'),
  document(OTHER_GUIDE_ID, 'Guide', DESIGN_FOLDER_ID, '2026-07-11T00:00:00.000Z'),
  document(NOTES_ID, 'Notes', null, '2026-07-12T00:00:00.000Z'),
];

describe('document resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listDocuments.mockResolvedValue(rows);
    listProjectFolders.mockResolvedValue([
      { id: LORE_FOLDER_ID, name: 'Lore' },
      { id: DESIGN_FOLDER_ID, name: 'Design' },
    ]);
  });

  it('lists project documents with folder names through the service boundaries', async () => {
    await expect(listResolvedProjectDocuments(supabase, PROJECT_ID)).resolves.toEqual([
      { ...rows[0], folderName: 'Lore' },
      { ...rows[1], folderName: 'Design' },
      { ...rows[2], folderName: null },
    ]);
    expect(listDocuments).toHaveBeenCalledWith(supabase, PROJECT_ID);
    expect(listProjectFolders).toHaveBeenCalledWith(supabase, PROJECT_ID);
  });

  it('gives an explicit project document ID precedence over name and current context', async () => {
    await expect(
      resolveDocumentForTool(
        supabase,
        PROJECT_ID,
        { documentId: NOTES_ID, documentName: 'Guide' },
        { currentDocumentId: GUIDE_ID }
      )
    ).resolves.toMatchObject({ ok: true, source: 'id', document: { id: NOTES_ID } });
  });

  it('resolves a unique exact document name', async () => {
    await expect(
      resolveDocumentForTool(supabase, PROJECT_ID, { documentName: 'Notes' }, {})
    ).resolves.toMatchObject({ ok: true, source: 'name', document: { id: NOTES_ID } });
  });

  it('uses an exact folder name to qualify a duplicate document name', async () => {
    await expect(
      resolveDocumentForTool(
        supabase,
        PROJECT_ID,
        { documentName: 'Guide', folderName: 'Design' },
        {}
      )
    ).resolves.toMatchObject({
      ok: true,
      source: 'name',
      document: { id: OTHER_GUIDE_ID, folderName: 'Design' },
    });
  });

  it('returns safe candidates instead of guessing an unqualified duplicate name', async () => {
    await expect(
      resolveDocumentForTool(supabase, PROJECT_ID, { documentName: 'Guide' }, {})
    ).resolves.toEqual({
      ok: false,
      code: 'AMBIGUOUS',
      error: 'Multiple documents named "Guide" were found in this project.',
      candidates: [
        {
          id: GUIDE_ID,
          name: 'Guide',
          folderId: LORE_FOLDER_ID,
          folderName: 'Lore',
          updatedAt: '2026-07-10T00:00:00.000Z',
        },
        {
          id: OTHER_GUIDE_ID,
          name: 'Guide',
          folderId: DESIGN_FOLDER_ID,
          folderName: 'Design',
          updatedAt: '2026-07-11T00:00:00.000Z',
        },
      ],
    });
  });

  it('falls back to the current document when no explicit selector is supplied', async () => {
    await expect(
      resolveDocumentForTool(supabase, PROJECT_ID, {}, { currentDocumentId: NOTES_ID })
    ).resolves.toMatchObject({ ok: true, source: 'current', document: { id: NOTES_ID } });
  });

  it('does not resolve a missing or cross-project explicit ID from outside the project list', async () => {
    await expect(
      resolveDocumentForTool(
        supabase,
        PROJECT_ID,
        { documentId: MISSING_ID, documentName: 'Notes' },
        { currentDocumentId: NOTES_ID }
      )
    ).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('returns NO_TARGET when neither a selector nor current document exists', async () => {
    await expect(resolveDocumentForTool(supabase, PROJECT_ID, {}, {})).resolves.toEqual({
      ok: false,
      code: 'NO_TARGET',
      error: 'No document was specified and there is no current document.',
    });
  });
});
