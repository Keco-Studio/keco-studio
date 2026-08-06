import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext, ToolResult } from '@/lib/agent/types';

const createLibraryServer = jest.fn();
const deleteLibraryServer = jest.fn();
const findFolderByName = jest.fn();
const findLibraryByName = jest.fn();
const getLibraryProperties = jest.fn();
const listProjectLibraries = jest.fn();
const resolveDocumentLibrarySourceDisplay = jest.fn();
const addLibraryField = jest.fn();
const scheduleLibrarySchemaReindex = jest.fn();

jest.mock('@/lib/agent/data-access', () => ({
  createLibraryServer: (...args: unknown[]) => createLibraryServer(...args),
  deleteLibraryServer: (...args: unknown[]) => deleteLibraryServer(...args),
  findFolderByName: (...args: unknown[]) => findFolderByName(...args),
  findLibraryByName: (...args: unknown[]) => findLibraryByName(...args),
  getLibraryProperties: (...args: unknown[]) => getLibraryProperties(...args),
  listProjectLibraries: (...args: unknown[]) => listProjectLibraries(...args),
  resolveDocumentLibrarySourceDisplay: (...args: unknown[]) =>
    resolveDocumentLibrarySourceDisplay(...args),
}));
jest.mock('@/lib/services/libraryAssetsService', () => ({
  addLibraryField: (...args: unknown[]) => addLibraryField(...args),
}));
jest.mock('@/lib/agent/embedding-index', () => ({
  scheduleLibrarySchemaReindex: (...args: unknown[]) => scheduleLibrarySchemaReindex(...args),
}));

import { metaForSave, resolveConversationMeta } from '@/lib/agent/conversation-meta';
import { createLibrary } from '@/lib/agent/tools/create-library';
import { setupLibrary } from '@/lib/agent/workflows/setup-library';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const FOLDER_ID = '33333333-3333-4333-8333-333333333333';
const documentExport = { sourceDocumentId: DOCUMENT_ID, exportType: 'table' as const };
const scope = { level: 'project' as const, projectId: PROJECT_ID };
const ctx = {
  supabase: {} as SupabaseClient,
  userId: '44444444-4444-4444-8444-444444444444',
  projectId: PROJECT_ID,
  conversationId: '55555555-5555-4555-8555-555555555555',
  userRole: 'admin',
} satisfies ToolContext;

describe('document table export conversation context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createLibraryServer.mockResolvedValue('library-id');
    deleteLibraryServer.mockResolvedValue(undefined);
    listProjectLibraries.mockResolvedValue([]);
    getLibraryProperties.mockResolvedValue([]);
    addLibraryField.mockResolvedValue({ id: 'field-id' });
    resolveDocumentLibrarySourceDisplay.mockResolvedValue({
      documentName: 'World Notes',
      folderId: FOLDER_ID,
      folderName: 'Design',
    });
  });

  it('persists and resolves the server-validated binding', () => {
    expect(metaForSave(false, scope, documentExport)).toEqual({
      autoExecute: false,
      scope,
      documentExport,
    });
    expect(resolveConversationMeta({ autoExecute: false, documentExport })).toEqual({
      autoExecute: false,
      documentExport,
    });
  });

  it('ignores an LLM folder in setup preview and displays the current document folder', async () => {
    const result = await setupLibrary.execute(
      {
        libraryName: 'Characters',
        folderName: 'LLM supplied folder',
        fields: [{ label: 'Name', dataType: 'string' }],
      },
      { ...ctx, documentExport }
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        libraryName: 'Characters',
        folderId: FOLDER_ID,
        folderName: 'Design',
        sourceDocumentName: 'World Notes',
      },
    });
    expect(findFolderByName).not.toHaveBeenCalled();
  });

  it('passes the binding when setup import creates the library', async () => {
    const preview: ToolResult = {
      success: true,
      data: {
        type: 'setup_library',
        libraryName: 'Characters',
        fields: [],
        totalFields: 0,
      },
    };

    const result = await setupLibrary.executeImport!(preview, {}, { ...ctx, documentExport });

    expect(createLibraryServer).toHaveBeenCalledWith(
      ctx.supabase,
      PROJECT_ID,
      'Characters',
      undefined,
      undefined,
      documentExport
    );
    expect(result.invalidations).toEqual([{
      type: 'library',
      id: 'library-id',
      projectId: PROJECT_ID,
      sourceDocumentId: DOCUMENT_ID,
    }]);
  });

  it('prepares and creates an empty library in the current document folder', async () => {
    const prepareConfirmation = createLibrary.prepareConfirmation;
    expect(prepareConfirmation).toEqual(expect.any(Function));
    if (!prepareConfirmation) return;

    const preparation = await prepareConfirmation(
      { name: 'Locations', folderName: 'LLM supplied folder' },
      { ...ctx, documentExport }
    );

    expect(preparation).toEqual({
      success: true,
      args: { name: 'Locations' },
      preview: {
        libraryName: 'Locations',
        folderId: FOLDER_ID,
        folderName: 'Design',
        sourceDocumentName: 'World Notes',
      },
    });

    const result = await createLibrary.execute({ name: 'Locations', folderName: 'LLM supplied folder' }, {
      ...ctx,
      documentExport,
    });

    expect(findFolderByName).not.toHaveBeenCalled();
    expect(createLibraryServer).toHaveBeenLastCalledWith(
      ctx.supabase,
      PROJECT_ID,
      'Locations',
      FOLDER_ID,
      undefined,
      documentExport
    );
    expect(result.invalidations).toEqual([{
      type: 'library',
      id: 'library-id',
      projectId: PROJECT_ID,
      sourceDocumentId: DOCUMENT_ID,
    }]);
  });

  it('does not expose source identifiers in either LLM tool schema', () => {
    const schemas = JSON.stringify([createLibrary.parameters, setupLibrary.parameters]);
    expect(schemas).not.toContain('sourceDocumentId');
    expect(schemas).not.toContain('documentExport');
  });
});
