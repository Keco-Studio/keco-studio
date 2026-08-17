import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccessVerificationContext } from '@/lib/services/authorizationService';

const getLibraryAssetsWithProperties = jest.fn();

jest.mock('server-only', () => ({}));
jest.mock('@/lib/services/libraryAssetsService', () => ({
  getLibraryAssetsWithProperties: (...args: unknown[]) =>
    getLibraryAssetsWithProperties(...args),
}));

import {
  prepareScriptDialogueDerivedTableOperations,
  prepareScriptDialogueLibraryReconciliation,
} from './scriptDialogueDerivedTableSyncService';

const dialogueFields = [
  { id: 'type-field', label: 'Type' },
  { id: 'name-field', label: 'Name' },
  { id: 'content-field', label: 'Content' },
];

function client(): SupabaseClient {
  const result = Promise.resolve({
    data: dialogueFields,
    error: null,
  });
  const query = {
    select: jest.fn(),
    eq: jest.fn(),
    then: result.then.bind(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return { from: jest.fn().mockReturnValue(query) } as unknown as SupabaseClient;
}

function derivedTablesClient(fieldsByLibrary: Record<string, Array<{ id: string; label: string }>>): SupabaseClient {
  return {
    from: jest.fn((table: string) => {
      let libraryId = '';
      const getResult = () => table === 'libraries'
        ? { data: Object.keys(fieldsByLibrary).map((id) => ({ id })), error: null }
        : { data: fieldsByLibrary[libraryId] ?? [], error: null };
      const query = {
        select: jest.fn(),
        eq: jest.fn((column: string, value: string) => {
          if (column === 'library_id') libraryId = value;
          return query;
        }),
        then: (resolve: (value: ReturnType<typeof getResult>) => unknown) => (
          Promise.resolve(getResult()).then(resolve)
        ),
      };
      query.select.mockReturnValue(query);
      return query;
    }),
  } as unknown as SupabaseClient;
}

describe('prepareScriptDialogueLibraryReconciliation', () => {
  beforeEach(() => {
    getLibraryAssetsWithProperties.mockReset();
  });

  it('forwards the authenticated actor context when reading through a service-role client', async () => {
    const access: AccessVerificationContext = {
      userId: '11111111-1111-4111-8111-111111111111',
      cache: new Map(),
    };
    getLibraryAssetsWithProperties.mockResolvedValueOnce([{
      id: 'speech-row',
      libraryId: 'library-id',
      name: 'Ada',
      rowIndex: 1,
      propertyValues: {
        'type-field': '1',
        'name-field': 'Ada',
        'content-field': 'Hello',
      },
    }]);

    await expect(prepareScriptDialogueLibraryReconciliation({
      supabase: client(),
      libraryId: 'library-id',
      access,
      command: {
        type: 'edit',
        role: 'speech',
        previousText: 'Ada: Hello',
        nextText: 'Ada: Changed',
      },
    })).resolves.toMatchObject({ operation: { type: 'edit' } });

    expect(getLibraryAssetsWithProperties).toHaveBeenCalledWith(
      expect.anything(),
      'library-id',
      access,
    );
  });
});

describe('prepareScriptDialogueDerivedTableOperations', () => {
  const command = {
    type: 'edit' as const,
    role: 'speech' as const,
    previousText: 'Ada: Hello',
    nextText: 'Ada: Changed',
  };

  beforeEach(() => {
    getLibraryAssetsWithProperties.mockReset();
  });

  it('skips unrelated tables while keeping operations for dialogue tables', async () => {
    getLibraryAssetsWithProperties.mockResolvedValueOnce([{
      id: 'speech-row',
      libraryId: 'dialogue-table',
      name: 'Ada',
      rowIndex: 1,
      propertyValues: {
        'type-field': '1',
        'name-field': 'Ada',
        'content-field': 'Hello',
      },
    }]);

    await expect(prepareScriptDialogueDerivedTableOperations({
      supabase: derivedTablesClient({
        'character-table': [{ id: 'bio-field', label: 'Biography' }],
        'dialogue-table': dialogueFields,
      }),
      projectId: 'project-id',
      documentId: 'document-id',
      command,
    })).resolves.toEqual([
      expect.objectContaining({ libraryId: 'dialogue-table', type: 'edit' }),
    ]);
  });

  it('does not silently skip a dialogue table whose row mapping is ambiguous', async () => {
    getLibraryAssetsWithProperties.mockResolvedValueOnce([]);

    await expect(prepareScriptDialogueDerivedTableOperations({
      supabase: derivedTablesClient({ 'dialogue-table': dialogueFields }),
      projectId: 'project-id',
      documentId: 'document-id',
      command,
    })).rejects.toThrow('DERIVED_TABLE_MAPPING_AMBIGUOUS');
  });

  it('includes the linked Script Conversation for a Table-origin edit', async () => {
    const inFilter = jest.fn();
    let libraryId = '';
    const supabase = {
      from: jest.fn((table: string) => {
        const getResult = () => table === 'libraries'
          ? {
              data: [{ id: 'dialogue-table' }, { id: 'script-conversation' }],
              error: null,
            }
          : { data: dialogueFields, error: null };
        const query = {
          select: jest.fn(),
          eq: jest.fn((column: string, value: string) => {
            if (column === 'library_id') libraryId = value;
            return query;
          }),
          in: inFilter,
          then: (resolve: (value: ReturnType<typeof getResult>) => unknown) => (
            Promise.resolve(getResult()).then(resolve)
          ),
        };
        void libraryId;
        query.select.mockReturnValue(query);
        inFilter.mockReturnValue(query);
        return query;
      }),
    } as unknown as SupabaseClient;
    getLibraryAssetsWithProperties
      .mockResolvedValueOnce([{
        id: 'table-speech',
        libraryId: 'dialogue-table',
        name: 'Ada',
        rowIndex: 1,
        propertyValues: {
          'type-field': '1',
          'name-field': 'Ada',
          'content-field': 'Hello',
        },
      }])
      .mockResolvedValueOnce([{
        id: 'script-speech',
        libraryId: 'script-conversation',
        name: 'Ada',
        rowIndex: 1,
        propertyValues: {
          'type-field': '1',
          'name-field': 'Ada',
          'content-field': 'Hello',
        },
      }]);

    await expect(prepareScriptDialogueDerivedTableOperations({
      supabase,
      projectId: 'project-id',
      documentId: 'document-id',
      command,
      includeScriptLibraries: true,
    })).resolves.toEqual([
      expect.objectContaining({ libraryId: 'dialogue-table' }),
      expect.objectContaining({ libraryId: 'script-conversation' }),
    ]);
    expect(inFilter).toHaveBeenCalledWith(
      'document_export_type',
      ['table', 'script'],
    );
  });
});
