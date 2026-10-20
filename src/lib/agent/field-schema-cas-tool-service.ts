import 'server-only';

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ToolContext, ToolResult } from './types';
import { scheduleLibrarySchemaReindex } from './embedding-index';

const uuid = z.string().uuid();
const types = ['string', 'string_array', 'int', 'int_array', 'float', 'float_array',
  'boolean', 'enum', 'date', 'reference', 'image', 'file', 'multimedia', 'audio'] as const;
const editSchema = z.object({ projectId: uuid, libraryId: uuid, fieldId: uuid,
  label: z.string().trim().min(1).max(200), dataType: z.enum(types),
  description: z.string().max(1000).nullable().optional(), required: z.boolean(),
  enumOptions: z.array(z.string().trim().min(1).max(200)).min(1).max(100).optional(),
  referenceTableIds: z.array(uuid).min(1).max(20).optional(),
  clearValuesOnTypeChange: z.boolean().default(false),
}).strict();
const deleteSchema = z.object({ projectId: uuid, libraryId: uuid, fieldId: uuid,
  clearValues: z.literal(true) }).strict();
const seal = z.object({ expectedUpdatedAt: z.string(), expectedFieldFingerprint: z.string().length(64),
  expectedFieldSnapshot: z.record(z.unknown()), expectedValueCount: z.number().int().nonnegative(),
  expectedValueFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const sealedEdit = editSchema.extend(seal.shape);
const sealedDelete = deleteSchema.extend(seal.shape);

function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function scope(ctx: ToolContext, projectId: string) {
  if (!ctx.userId || ctx.projectId !== projectId) throw new Error('Project is outside this conversation.');
}

async function current(ctx: ToolContext, input: { projectId: string; libraryId: string; fieldId: string }) {
  scope(ctx, input.projectId);
  const library = await ctx.supabase.from('libraries').select('id,project_id,name,updated_at')
    .eq('id', input.libraryId).eq('project_id', input.projectId).maybeSingle();
  if (library.error || !library.data) throw new Error('Library not found in this project.');
  const field = await ctx.supabase.from('library_field_definitions')
    .select('id,library_id,label,data_type,description,required,enum_options,reference_libraries,section,section_id,order_index,formula_expression')
    .eq('id', input.fieldId).eq('library_id', input.libraryId).maybeSingle();
  if (field.error || !field.data) throw new Error('Field not found in this library.');
  const values = await ctx.supabase.rpc('agent_field_values_snapshot', {
    p_project_id: input.projectId, p_table_id: input.libraryId, p_field_id: input.fieldId,
  });
  if (values.error || !values.data || !Number.isSafeInteger(values.data.count) ||
    !/^[a-f0-9]{64}$/.test(values.data.fingerprint)) throw new Error('Field values could not be counted.');
  return { library: library.data, field: field.data, valueCount: values.data.count as number,
    valueFingerprint: values.data.fingerprint as string,
    fieldFingerprint: fingerprint(field.data) };
}

function stale(currentState: Awaited<ReturnType<typeof current>>, input: z.infer<typeof seal>) {
  if (currentState.library.updated_at !== input.expectedUpdatedAt ||
    currentState.fieldFingerprint !== input.expectedFieldFingerprint ||
    fingerprint(input.expectedFieldSnapshot) !== input.expectedFieldFingerprint ||
    currentState.valueCount !== input.expectedValueCount ||
    currentState.valueFingerprint !== input.expectedValueFingerprint) {
    throw new Error('Library schema or field values changed after approval. Request confirmation again.');
  }
}

function failed(error: unknown): ToolResult {
  const known = error instanceof Error && /^(Project is outside|Library not found|Field not found|Field values could|Library schema or field values changed|Unsupported field type|Type change requires|Field has values|Cannot delete)/.test(error.message)
    ? error.message : null;
  return { success: false, error: error instanceof z.ZodError ? 'Invalid field parameters.'
    : known ?? 'Field schema change failed. Read the schema again and check edit permission.' };
}

function validateEdit(input: z.infer<typeof editSchema>, state: Awaited<ReturnType<typeof current>>) {
  if (!types.includes(state.field.data_type as typeof types[number])) {
    throw new Error(`Unsupported field type ${state.field.data_type ?? 'untyped'} for this edit Tool.`);
  }
  if (input.dataType === 'enum' ? !input.enumOptions || input.referenceTableIds !== undefined : input.enumOptions !== undefined) {
    throw new Error('Invalid enum options for field type.');
  }
  if (input.dataType === 'reference' ? !input.referenceTableIds || input.enumOptions !== undefined : input.referenceTableIds !== undefined) {
    throw new Error('Invalid reference targets for field type.');
  }
  if (state.field.data_type !== input.dataType && state.valueCount > 0 && !input.clearValuesOnTypeChange) {
    throw new Error('Type change requires explicit clearValuesOnTypeChange when values exist.');
  }
}

export async function prepareFieldEdit(ctx: ToolContext, params: unknown) {
  const input = editSchema.parse(params);
  const state = await current(ctx, { projectId: input.projectId!, libraryId: input.libraryId!, fieldId: input.fieldId! });
  validateEdit(input, state);
  const typeChanged = state.field.data_type !== input.dataType;
  return { args: { ...input, expectedUpdatedAt: state.library.updated_at,
    expectedFieldFingerprint: state.fieldFingerprint, expectedFieldSnapshot: state.field,
    expectedValueCount: state.valueCount, expectedValueFingerprint: state.valueFingerprint },
    preview: { action: 'edit_library_field', projectId: input.projectId,
      libraryId: input.libraryId, libraryName: state.library.name, fieldId: input.fieldId,
      current: { label: state.field.label, dataType: state.field.data_type },
      next: { label: input.label, dataType: input.dataType },
      storedValueCount: state.valueCount, typeChanged,
      valuesWillBeCleared: typeChanged && state.valueCount > 0 && input.clearValuesOnTypeChange } };
}

export async function editField(ctx: ToolContext, params: unknown): Promise<ToolResult> {
  try {
    const input = sealedEdit.parse(params);
    const state = await current(ctx, { projectId: input.projectId!, libraryId: input.libraryId!, fieldId: input.fieldId! });
    stale(state, input);
    validateEdit(input, state);
    const field = { label: input.label, dataType: input.dataType,
      description: input.description === undefined ? state.field.description : input.description,
      required: input.required, section: state.field.section,
      sectionId: state.field.section_id,
      ...(input.dataType === 'enum' ? { enumOptions: input.enumOptions } : {}),
      ...(input.dataType === 'reference' ? { referenceTableIds: input.referenceTableIds } : {}) };
    const { data, error } = await ctx.supabase.rpc('agent_edit_table_field_if_current', {
      p_project_id: input.projectId, p_table_id: input.libraryId, p_field_id: input.fieldId,
      p_field: field, p_clear_values_on_type_change: input.clearValuesOnTypeChange,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_expected_field: input.expectedFieldSnapshot,
      p_expected_value_count: input.expectedValueCount,
      p_expected_value_fingerprint: input.expectedValueFingerprint,
    });
    if (error) throw error;
    if (!data) throw new Error('Library schema or field values changed after approval. Request confirmation again.');
    scheduleLibrarySchemaReindex(ctx.supabase, { projectId: input.projectId, libraryId: input.libraryId });
    return { success: true, schemaChanged: true, displayHint: 'text', data: {
      projectId: input.projectId, libraryId: input.libraryId, fieldId: input.fieldId,
      before: { label: state.field.label, dataType: state.field.data_type },
      after: { label: data.label, dataType: data.data_type },
      clearedValueCount: data.cleared_value_count, updatedAt: data.updated_at },
      invalidations: [{ type: 'library', id: input.libraryId, projectId: input.projectId }] };
  } catch (error) { return failed(error); }
}

export async function prepareFieldDelete(ctx: ToolContext, params: unknown) {
  const input = deleteSchema.parse(params);
  const state = await current(ctx, { projectId: input.projectId!, libraryId: input.libraryId!, fieldId: input.fieldId! });
  return { args: { ...input, expectedUpdatedAt: state.library.updated_at,
    expectedFieldFingerprint: state.fieldFingerprint, expectedFieldSnapshot: state.field,
    expectedValueCount: state.valueCount, expectedValueFingerprint: state.valueFingerprint },
    preview: { action: 'delete_library_field', projectId: input.projectId,
      libraryId: input.libraryId, libraryName: state.library.name, fieldId: input.fieldId,
      label: state.field.label, dataType: state.field.data_type, storedValueCount: state.valueCount,
      consequence: 'Permanently delete this field and its stored values.' } };
}

export async function deleteField(ctx: ToolContext, params: unknown): Promise<ToolResult> {
  try {
    const input = sealedDelete.parse(params);
    const state = await current(ctx, { projectId: input.projectId!, libraryId: input.libraryId!, fieldId: input.fieldId! });
    stale(state, input);
    const { data, error } = await ctx.supabase.rpc('agent_delete_table_field_if_current', {
      p_project_id: input.projectId, p_table_id: input.libraryId, p_field_id: input.fieldId,
      p_clear_values: true, p_expected_updated_at: input.expectedUpdatedAt,
      p_expected_field: input.expectedFieldSnapshot,
      p_expected_value_count: input.expectedValueCount,
      p_expected_value_fingerprint: input.expectedValueFingerprint,
    });
    if (error) throw error;
    if (!data) throw new Error('Library schema or field values changed after approval. Request confirmation again.');
    scheduleLibrarySchemaReindex(ctx.supabase, { projectId: input.projectId, libraryId: input.libraryId });
    return { success: true, schemaChanged: true, displayHint: 'text', data: {
      projectId: input.projectId, libraryId: input.libraryId, fieldId: input.fieldId,
      label: state.field.label, deletedValueCount: data.deleted_value_count,
      updatedAt: data.updated_at },
      invalidations: [{ type: 'library', id: input.libraryId, projectId: input.projectId }] };
  } catch (error) { return failed(error); }
}

export function preparationFailure(error: unknown) {
  return { success: false as const, error: failed(error).error! };
}
