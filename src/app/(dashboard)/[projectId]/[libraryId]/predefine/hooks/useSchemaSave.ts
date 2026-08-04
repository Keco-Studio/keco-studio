import type { FieldConfig } from '@/app/(dashboard)/[projectId]/[libraryId]/predefine/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getInternalFieldGroupColumns } from '@/lib/library/fieldCompatibility';

interface FieldDefinitionRow {
  id: string;
  library_id: string;
  section_id: string;
  section: string;
  label: string;
  description: string | null;
  data_type: string | null;
  enum_options: string[] | null;
  reference_libraries: string[] | null;
  required: boolean;
  order_index: number;
}

function isDatabaseId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export async function saveSchemaIncremental(
  supabase: SupabaseClient,
  libraryId: string,
  fieldsToSave: FieldConfig[]
): Promise<{ tempIdToDbIdMap: Map<string, string> }> {
  const { data: existingRows, error: fetchError } = await supabase
    .from('library_field_definitions')
    .select('*')
    .eq('library_id', libraryId);
  if (fetchError) throw fetchError;

  const existing = (existingRows ?? []) as FieldDefinitionRow[];
  const existingById = new Map(existing.map((row) => [row.id, row]));
  const keptIds = new Set<string>();
  const fieldsToClearValues: string[] = [];
  const tempIdToDbIdMap = new Map<string, string>();
  const toUpdate: FieldDefinitionRow[] = [];
  const toInsert: Array<{ tempId: string; row: Omit<FieldDefinitionRow, 'id'> }> = [];

  const compatibility = getInternalFieldGroupColumns(libraryId);
  const compatibilityForExisting = (row?: FieldDefinitionRow) =>
    row ? { section_id: row.section_id, section: row.section } : compatibility;

  fieldsToSave.forEach((field, orderIndex) => {
    const existingField = isDatabaseId(field.id) ? existingById.get(field.id) : undefined;
    const group = compatibilityForExisting(existingField);
    const row = {
      library_id: libraryId,
      ...group,
      label: field.label,
      description: field.description ?? null,
      data_type: field.dataType ?? null,
      enum_options: field.dataType === 'enum' ? field.enumOptions ?? [] : null,
      reference_libraries: field.dataType === 'reference' ? field.referenceLibraries ?? [] : null,
      required: field.required,
      order_index: orderIndex,
    };

    if (existingField) {
      keptIds.add(existingField.id);
      const dataTypeChanged = existingField.data_type !== row.data_type;
      if (
        dataTypeChanged ||
        existingField.section_id !== row.section_id ||
        existingField.section !== row.section ||
        existingField.label !== row.label ||
        existingField.description !== row.description ||
        JSON.stringify(existingField.enum_options) !== JSON.stringify(row.enum_options) ||
        JSON.stringify(existingField.reference_libraries) !== JSON.stringify(row.reference_libraries) ||
        existingField.required !== row.required ||
        existingField.order_index !== row.order_index
      ) {
        toUpdate.push({ ...existingField, ...row });
      }
      if (dataTypeChanged) fieldsToClearValues.push(existingField.id);
    } else {
      toInsert.push({ tempId: field.id, row });
    }
  });

  const toDelete = existing.filter((row) => !keptIds.has(row.id)).map((row) => row.id);

  if (fieldsToClearValues.length > 0) {
    const { error } = await supabase
      .from('library_asset_values')
      .delete()
      .in('field_id', fieldsToClearValues);
    if (error) throw error;
  }
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from('library_field_definitions')
      .delete()
      .in('id', toDelete);
    if (error) throw error;
  }

  for (let index = 0; index < toUpdate.length; index += 1) {
    const { error } = await supabase
      .from('library_field_definitions')
      .update({ order_index: -(index + 1) })
      .eq('id', toUpdate[index].id);
    if (error) throw error;
  }
  for (const row of toUpdate) {
    const { error } = await supabase
      .from('library_field_definitions')
      .update({
        section_id: row.section_id,
        section: row.section,
        label: row.label,
        description: row.description,
        data_type: row.data_type,
        enum_options: row.enum_options,
        reference_libraries: row.reference_libraries,
        required: row.required,
        order_index: row.order_index,
      })
      .eq('id', row.id);
    if (error) throw error;
  }

  if (toInsert.length > 0) {
    const { data: inserted, error } = await supabase
      .from('library_field_definitions')
      .insert(toInsert.map((item) => item.row))
      .select('id, order_index');
    if (error) throw error;
    for (const item of toInsert) {
      const match = (inserted ?? []).find((row) => row.order_index === item.row.order_index);
      if (match) tempIdToDbIdMap.set(item.tempId, match.id);
    }
  }

  return { tempIdToDbIdMap };
}
