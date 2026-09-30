import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';

const addLibraryField = jest.fn();
const findLibraryByName = jest.fn();

jest.mock('@/lib/services/libraryAssetsService', () => ({ addLibraryField }));
jest.mock('@/lib/agent/data-access', () => ({ findLibraryByName }));
jest.mock('@/lib/agent/embedding-index', () => ({ scheduleLibrarySchemaReindex: jest.fn() }));

import { addField } from '@/lib/agent/tools/add-field';

const ctx = {
  userId: 'user-1', projectId: 'project-1', conversationId: 'conversation-1',
  workspace: 'studio', currentLibraryId: 'library-1', currentLibraryName: 'Library',
  supabase: {} as SupabaseClient,
} satisfies ToolContext;

describe('add_field schema change signal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findLibraryByName.mockResolvedValue({
      library: { id: 'library-1', name: 'Library' }, available: [],
    });
  });

  it('signals a schema rebuild only after the field is added', async () => {
    addLibraryField.mockResolvedValueOnce({ id: 'field-1' });
    expect(await addField.execute({ label: 'Cost', dataType: 'int' }, ctx))
      .toEqual(expect.objectContaining({ success: true, schemaChanged: true }));

    addLibraryField.mockRejectedValueOnce(new Error('write failed'));
    const failed = await addField.execute({ label: 'Cost', dataType: 'int' }, ctx);
    expect(failed).toEqual(expect.objectContaining({ success: false, error: 'write failed' }));
    expect(failed.schemaChanged).toBeUndefined();
  });
});
