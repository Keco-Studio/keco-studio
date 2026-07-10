import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoryDocument } from '@/lib/story-ir/schema';

jest.mock('@/lib/agent/data-access', () => ({
  getFolderRow: jest.fn(),
}));
jest.mock('@/lib/services/scriptConversionService', () => ({
  resolveStoryForImport: jest.fn(),
}));
jest.mock('@/lib/services/scriptImportService', () => ({
  importStoryDocument: jest.fn(),
}));

import { getFolderRow } from '@/lib/agent/data-access';
import { resolveStoryForImport } from '@/lib/services/scriptConversionService';
import { importStoryDocument } from '@/lib/services/scriptImportService';
import { executeAgentTool } from '@/lib/agent/tool-execution-stream';
import { importScript } from '@/lib/agent/tools/import-script';
import type { ToolContext, ToolResult } from '@/lib/agent/types';

const mockedGetFolderRow = getFolderRow as jest.MockedFunction<typeof getFolderRow>;
const mockedResolve = resolveStoryForImport as jest.MockedFunction<typeof resolveStoryForImport>;
const mockedImport = importStoryDocument as jest.MockedFunction<typeof importStoryDocument>;

const folderId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const ref = { sourceId: 'src', unitId: 'src:0', start: 0, end: 8 };
const document: StoryDocument = {
  version: 1,
  entryLabel: 'Start',
  nodes: [{
    label: 'Start',
    type: 'dialogue',
    speaker: 'Guide',
    content: 'Original',
    commands: [],
    options: [],
    sourceRefs: [ref],
  }],
};

function context(): ToolContext {
  return {
    userId: 'user-1',
    projectId,
    conversationId: 'conversation-1',
    supabase: {} as SupabaseClient,
    userRole: 'editor',
    authoritativeUserSource: {
      messageId: 'message-1',
      content: 'prefix\nOriginal\nsuffix',
    },
  };
}

describe('import_script Story IR tool', () => {
  beforeEach(() => {
    mockedGetFolderRow.mockReset().mockResolvedValue({ id: folderId, project_id: projectId } as never);
    mockedResolve.mockReset().mockImplementation(async (source, options) => {
      options?.onProgress?.({ phase: 'conversion', attempt: 1, message: 'Converting' } as never);
      expect(source).toBe('Original');
      return { document } as never;
    });
    mockedImport.mockReset().mockResolvedValue({ libraryId: 'library-1', rowCount: 1, fieldCount: 11 });
  });

  it('streams audited conversion and imports the validated document directly', async () => {
    const params = {
      libraryName: 'Story',
      folderId,
      sourceText: 'model rewrite',
      sourceStart: 7,
      sourceEnd: 15,
    };
    const iterator = executeAgentTool(importScript, params, context());
    expect(await iterator.next()).toEqual({
      done: false,
      value: { phase: 'conversion', attempt: 1, message: 'Converting' },
    });
    expect(await iterator.next()).toEqual({
      done: false,
      value: { phase: 'table_compile', message: 'Compiling script table' },
    });
    expect(await iterator.next()).toEqual({
      done: false,
      value: { phase: 'database_write', message: 'Writing script library' },
    });
    const done = await iterator.next();
    expect(done.done).toBe(true);
    expect((done.value as ToolResult).data).toMatchObject({
      libraryId: 'library-1',
      libraryName: 'Story',
      rowCount: 1,
      fieldCount: 11,
    });
    expect(importScript.confirmationRequired).toBe(false);
    expect(mockedImport).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      document,
      libraryName: 'Story',
    }));
  });

  it('does not write when conversion or audit fails', async () => {
    mockedResolve.mockRejectedValue(new Error('Semantic audit failed'));
    const params = { libraryName: 'Story', folderId, sourceStart: 7, sourceEnd: 15 };
    const iterator = executeAgentTool(importScript, params, context());
    const done = await iterator.next();

    expect(done.done).toBe(true);
    expect((done.value as ToolResult)).toMatchObject({ success: false, error: 'Semantic audit failed' });
    expect(mockedImport).not.toHaveBeenCalled();
  });
});
