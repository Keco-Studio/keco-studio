import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/agent/embedding-index', () => ({ scheduleLibrarySchemaReindex: jest.fn() }));

import { editLibraryFieldTool } from '@/lib/agent/tools/edit-library-field';
import { deleteLibraryFieldTool } from '@/lib/agent/tools/delete-library-field';
import { scheduleLibrarySchemaReindex } from '@/lib/agent/embedding-index';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), libraryId = id(2), fieldId = id(3);
let ctx: ToolContext;
let rpc: jest.Mock;
let field: Record<string, unknown>;
let library: Record<string, unknown>;
let count: number;
let valueFingerprint: string;

beforeEach(() => {
  jest.clearAllMocks();
  library = { id: libraryId, project_id: projectId, name: 'Items', updated_at: '2026-09-28T00:00:00Z' };
  field = { id: fieldId, library_id: libraryId, label: 'Name', data_type: 'string',
    description: 'Old', required: false, enum_options: null, reference_libraries: null,
    section: 'Main', section_id: 'main', order_index: 0, formula_expression: null };
  count = 3;
  valueFingerprint = 'a'.repeat(64);
  rpc = jest.fn().mockImplementation(async (name: string) => ({ data: name === 'agent_field_values_snapshot'
    ? { count, fingerprint: valueFingerprint }
    : name.includes('edit')
      ? { label: 'Title', data_type: 'enum', cleared_value_count: 3, updated_at: 'next' }
      : { deleted_value_count: 3, updated_at: 'next' }, error: null }));
  const from = jest.fn((table: string) => {
    const filters: Array<[string, unknown]> = [];
    const query = {
      select() { return this; },
      eq(column: string, value: unknown) { filters.push([column, value]); return this; },
      async maybeSingle() {
        const source = table === 'libraries' ? library : field;
        return { data: filters.every(([key, value]) => source[key] === value) ? { ...source } : null, error: null };
      },
    };
    return query;
  });
  ctx = { userId: id(9), projectId, workspace: 'studio', conversationId: id(8),
    supabase: { from, rpc } as unknown as SupabaseClient };
});

const base = { projectId, libraryId, fieldId };

it('previews type-change value loss and sends sealed CAS edit with preserved section', async () => {
  const params = { ...base, label: 'Title', dataType: 'enum', enumOptions: ['A', 'B'],
    required: true, clearValuesOnTypeChange: true };
  expect(editLibraryFieldTool.confirmationPolicy).toBe('always');
  const prepared = await editLibraryFieldTool.prepareConfirmation!(params, ctx);
  expect(prepared).toMatchObject({ success: true, preview: { fieldId, storedValueCount: 3,
    typeChanged: true, valuesWillBeCleared: true }, args: { expectedUpdatedAt: library.updated_at } });
  expect(await editLibraryFieldTool.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: true, data: { clearedValueCount: 3 } });
  expect(rpc).toHaveBeenCalledWith('agent_edit_table_field_if_current', {
    p_project_id: projectId, p_table_id: libraryId, p_field_id: fieldId,
    p_field: { label: 'Title', dataType: 'enum', description: 'Old', required: true,
      section: 'Main', sectionId: 'main', enumOptions: ['A', 'B'] },
    p_clear_values_on_type_change: true, p_expected_updated_at: library.updated_at,
    p_expected_field: field, p_expected_value_count: 3,
    p_expected_value_fingerprint: valueFingerprint,
  });
  expect(scheduleLibrarySchemaReindex).toHaveBeenCalled();
});

it('requires explicit value clearing for a populated type change', async () => {
  expect(await editLibraryFieldTool.prepareConfirmation!({ ...base, label: 'Title',
    dataType: 'int', required: false }, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('clearValuesOnTypeChange') });
  expect(rpc).not.toHaveBeenCalledWith('agent_edit_table_field_if_current', expect.anything());
});

it.each(['file', 'multimedia', 'audio'] as const)(
  'edits existing %s field metadata without clearing its uploaded values', async (dataType) => {
    field.data_type = dataType;
    const params = { ...base, label: 'Attachments', dataType, description: 'Revised', required: true };
    const prepared = await editLibraryFieldTool.prepareConfirmation!(params, ctx);
    expect(prepared).toMatchObject({ success: true, preview: {
      current: { dataType }, next: { dataType }, storedValueCount: 3,
      typeChanged: false, valuesWillBeCleared: false,
    } });
    expect(await editLibraryFieldTool.execute((prepared as { args: unknown }).args, ctx))
      .toMatchObject({ success: true });
    expect(rpc).toHaveBeenCalledWith('agent_edit_table_field_if_current',
      expect.objectContaining({ p_field: expect.objectContaining({
        dataType, description: 'Revised', required: true,
      }), p_clear_values_on_type_change: false, p_expected_value_count: 3 }));
  }
);

it('requires confirmed value loss when changing a populated media field type', async () => {
  field.data_type = 'file';
  const params = { ...base, label: 'Sound', dataType: 'audio', required: false };
  expect(await editLibraryFieldTool.prepareConfirmation!(params, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('clearValuesOnTypeChange') });
  const prepared = await editLibraryFieldTool.prepareConfirmation!(
    { ...params, clearValuesOnTypeChange: true }, ctx);
  expect(prepared).toMatchObject({ success: true, preview: {
    typeChanged: true, storedValueCount: 3, valuesWillBeCleared: true,
  } });
  expect(await editLibraryFieldTool.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: true, data: { clearedValueCount: 3 } });
  expect(rpc).toHaveBeenCalledWith('agent_edit_table_field_if_current',
    expect.objectContaining({ p_field: expect.objectContaining({ dataType: 'audio' }),
      p_clear_values_on_type_change: true, p_expected_value_count: 3 }));
});

it('rejects unsupported current types and stale field/value approvals', async () => {
  field.data_type = 'formula';
  expect(await editLibraryFieldTool.prepareConfirmation!({ ...base, label: 'Title',
    dataType: 'string', required: false }, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('Unsupported field type') });
  field.data_type = 'string';
  const prepared = await editLibraryFieldTool.prepareConfirmation!({ ...base, label: 'Title',
    dataType: 'string', required: false }, ctx);
  count = 4;
  expect(await editLibraryFieldTool.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('changed after approval') });
  expect(rpc).not.toHaveBeenCalledWith('agent_edit_table_field_if_current', expect.anything());
});

it('rejects a same-count cell value edit after approval', async () => {
  const prepared = await editLibraryFieldTool.prepareConfirmation!({ ...base, label: 'Title',
    dataType: 'string', required: false }, ctx);
  valueFingerprint = 'b'.repeat(64);
  expect(await editLibraryFieldTool.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('changed after approval') });
  expect(rpc).not.toHaveBeenCalledWith('agent_edit_table_field_if_current', expect.anything());
});

it('previews deletion and calls the atomic CAS delete', async () => {
  expect(deleteLibraryFieldTool.confirmationPolicy).toBe('always');
  const prepared = await deleteLibraryFieldTool.prepareConfirmation!({ ...base, clearValues: true }, ctx);
  expect(prepared).toMatchObject({ success: true, preview: { label: 'Name', storedValueCount: 3 } });
  expect(await deleteLibraryFieldTool.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: true, data: { deletedValueCount: 3 } });
  expect(rpc).toHaveBeenCalledWith('agent_delete_table_field_if_current', {
    p_project_id: projectId, p_table_id: libraryId, p_field_id: fieldId,
    p_clear_values: true, p_expected_updated_at: library.updated_at,
    p_expected_field: field, p_expected_value_count: 3,
    p_expected_value_fingerprint: valueFingerprint,
  });
});

it('rejects a library outside the frozen project before CAS', async () => {
  expect(await deleteLibraryFieldTool.prepareConfirmation!({ ...base, projectId: id(99), clearValues: true }, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('outside this conversation') });
  expect(rpc).not.toHaveBeenCalledWith('agent_delete_table_field_if_current', expect.anything());
});
