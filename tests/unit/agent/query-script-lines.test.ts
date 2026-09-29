import { describe, expect, it, jest } from '@jest/globals';
import { getLibraryAssets } from '@/lib/agent/data-access';
import { queryScriptLines, getScriptOptionIndexes } from '@/lib/agent/tools/query-script-lines';
import { getLibraryProperties, libraryFromLookupResult, resolveLibraryForTool } from '@/lib/agent/tools/_shared';

jest.mock('@/lib/agent/data-access', () => ({
  getLibraryAssets: jest.fn(),
  getLibraryProperties: jest.fn(),
}));
jest.mock('@/lib/agent/tools/_shared', () => ({
  errorFromLookupResult: (result: { ok: boolean; error?: string }) => result.ok ? undefined : result.error,
  getLibraryProperties: jest.fn(),
  libraryFromLookupResult: (result: { library: { id: string; name: string } }) => result.library,
  resolveLibraryForTool: jest.fn(),
}));

import type { ToolContext } from '@/lib/agent/types';

const getLibraryAssetsMock = getLibraryAssets as jest.MockedFunction<typeof getLibraryAssets>;
const getLibraryPropertiesMock = getLibraryProperties as jest.MockedFunction<typeof getLibraryProperties>;
const resolveLibraryForToolMock = resolveLibraryForTool as jest.MockedFunction<typeof resolveLibraryForTool>;

describe('query_script_lines dynamic options', () => {
  it('discovers option indexes numerically from dynamic field names', () => {
    expect(getScriptOptionIndexes([
      'Option10_Commands',
      'Option2_Next',
      'Content',
      'Option10',
      'Option2',
      'Option10_Next',
    ])).toEqual([2, 10]);
  });

  it('returns persisted UUIDs for exact follow-up Script edits', async () => {
    resolveLibraryForToolMock.mockResolvedValue({
      ok: true,
      library: { id: 'library-1', name: 'Story' },
    });
    getLibraryPropertiesMock.mockResolvedValue([
      { id: 'field-label', key: 'label', name: 'Label', valueType: 'string', orderIndex: 0 },
      { id: 'field-type', key: 'type', name: 'Type', valueType: 'string', orderIndex: 1 },
      { id: 'field-name', key: 'name', name: 'Name', valueType: 'string', orderIndex: 2 },
      { id: 'field-content', key: 'content', name: 'Content', valueType: 'string', orderIndex: 3 },
    ]);
    getLibraryAssetsMock.mockResolvedValue([{
      id: '11111111-1111-4111-8111-111111111111',
      libraryId: 'library-1',
      name: 'Opening',
      propertyValues: {
        label: 'Intro',
        type: '0',
        name: 'Opening',
        content: 'Welcome',
      },
    }]);

    const result = await queryScriptLines.execute({}, {
      supabase: {},
      projectId: 'project-1',
      userId: 'user-1',
      userRole: 'editor',
      currentLibraryName: 'Story',
    } as ToolContext);

    expect(result).toMatchObject({
      success: true,
      data: {
        lines: [{
          id: '11111111-1111-4111-8111-111111111111',
          assetId: '11111111-1111-4111-8111-111111111111',
          nodeId: '11111111-1111-4111-8111-111111111111',
          label: 'Intro',
          content: 'Welcome',
        }],
      },
    });
  });
});
