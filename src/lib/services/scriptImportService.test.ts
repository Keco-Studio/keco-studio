import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SCRIPT_COLUMNS } from '@/lib/script-parser';
import { importScriptFromFile } from './scriptImportService';
import { importStoryDocument } from './scriptImportService';
import type { StoryDocument } from '@/lib/story-ir/schema';
import { buildStoryColumns } from '@/lib/story-ir/tableCompiler';

jest.mock('@/lib/services/authorizationService', () => ({
  verifyLibraryCreationPermission: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

type InsertCall = {
  table: string;
  values: unknown;
};

function fakeSupabase(options: { failValueInsert?: boolean } = {}) {
  const insertCalls: InsertCall[] = [];
  const deleteCalls: Array<{ table: string; column: string; value: string }> = [];
  let fieldIdCounter = 0;
  let assetIdCounter = 0;

  const supabase = {
    from(table: string) {
      const query = {
        insertedValues: undefined as unknown,
        deleting: false,
        select() {
          return query;
        },
        eq(column?: string, value?: string) {
          if (query.deleting) {
            deleteCalls.push({ table, column: column ?? '', value: value ?? '' });
            return Promise.resolve({ data: null, error: null });
          }
          return query;
        },
        limit() {
          if (table === 'libraries') {
            return Promise.resolve({ data: [], error: null });
          }
          return query;
        },
        insert(values: unknown) {
          query.insertedValues = values;
          insertCalls.push({ table, values });
          return query;
        },
        delete() {
          query.deleting = true;
          return query;
        },
        single() {
          if (table === 'folders') {
            return Promise.resolve({
              data: { id: '11111111-1111-4111-8111-111111111111', project_id: '22222222-2222-4222-8222-222222222222' },
              error: null,
            });
          }
          if (table === 'libraries') {
            return Promise.resolve({ data: { id: '33333333-3333-4333-8333-333333333333' }, error: null });
          }
          if (table === 'library_field_definitions') {
            fieldIdCounter += 1;
            return Promise.resolve({ data: { id: `field-${fieldIdCounter}` }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (value: { data: unknown; error: null }) => void) {
          if (table === 'library_field_definitions') {
            const rows = Array.isArray(query.insertedValues) ? query.insertedValues : [query.insertedValues];
            resolve({
              data: rows.map((row) => {
                fieldIdCounter += 1;
                const insertedRow = row as { order_index?: number };
                return { id: `field-${fieldIdCounter}`, order_index: insertedRow.order_index };
              }),
              error: null,
            });
            return;
          }
          if (table === 'library_assets') {
            const rows = Array.isArray(query.insertedValues) ? query.insertedValues : [query.insertedValues];
            resolve({
              data: rows.map(() => {
                assetIdCounter += 1;
                return { id: `asset-${assetIdCounter}` };
              }),
              error: null,
            });
            return;
          }
          if (table === 'library_asset_values' && options.failValueInsert) {
            resolve({ data: null, error: { message: 'value insert failed' } } as never);
            return;
          }
          resolve({ data: null, error: null });
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;

  return { supabase, insertCalls, deleteCalls };
}

const ref = { sourceId: 'src', unitId: 'src:0', start: 0, end: 1 };
const storyDocument: StoryDocument = {
  version: 1,
  entryLabel: 'Start',
  nodes: [{
    label: 'Start',
    type: 'dialogue',
    speaker: 'Guide',
    content: 'Choose',
    commands: [],
    options: Array.from({ length: 4 }, (_, index) => ({
      text: `Choice ${index}`,
      target: `O${index}`,
      commands: [],
      sourceRefs: [ref],
    })),
    sourceRefs: [ref],
  }, ...Array.from({ length: 4 }, (_, index) => ({
    label: `O${index}`,
    type: 'narration' as const,
    content: `Ending ${index}`,
    commands: [],
    options: [],
    sourceRefs: [ref],
  }))],
};

describe('importScriptFromFile', () => {
  it('bulk inserts script field definitions in one request', async () => {
    const { supabase, insertCalls } = fakeSupabase();

    await importScriptFromFile(supabase, {
      userId: '44444444-4444-4444-8444-444444444444',
      projectId: '22222222-2222-4222-8222-222222222222',
      folderId: '11111111-1111-4111-8111-111111111111',
      libraryName: 'Performance fixture',
      fileName: 'fixture.txt',
      fileContent: '【Start｜Scene】\n（Type1・Atana）Hello',
    });

    const fieldDefinitionCalls = insertCalls.filter((call) => call.table === 'library_field_definitions');
    expect(fieldDefinitionCalls).toHaveLength(1);
    expect(fieldDefinitionCalls[0].values).toHaveLength(SCRIPT_COLUMNS.length);
  });

  it('imports Story IR with dynamic option field definitions', async () => {
    const { supabase, insertCalls } = fakeSupabase();

    const result = await importStoryDocument(supabase, {
      userId: '44444444-4444-4444-8444-444444444444',
      projectId: '22222222-2222-4222-8222-222222222222',
      folderId: '11111111-1111-4111-8111-111111111111',
      libraryName: 'Dynamic fixture',
      fileName: 'fixture.txt',
      document: storyDocument,
    });

    const fieldCall = insertCalls.find((call) => call.table === 'library_field_definitions');
    expect(fieldCall?.values).toHaveLength(buildStoryColumns(4).length);
    expect(buildStoryColumns(4).slice(17)).toEqual(['Option3', 'Option3_Next']);
    expect(result.rowCount).toBe(storyDocument.nodes.length);
  });

  it('removes a newly created library when a later value insert fails', async () => {
    const { supabase, deleteCalls } = fakeSupabase({ failValueInsert: true });

    await expect(importStoryDocument(supabase, {
      userId: '44444444-4444-4444-8444-444444444444',
      projectId: '22222222-2222-4222-8222-222222222222',
      folderId: '11111111-1111-4111-8111-111111111111',
      libraryName: 'Cleanup fixture',
      fileName: 'fixture.txt',
      document: storyDocument,
    })).rejects.toMatchObject({ message: 'value insert failed' });

    expect(deleteCalls).toContainEqual({
      table: 'libraries',
      column: 'id',
      value: '33333333-3333-4333-8333-333333333333',
    });
  });
});
