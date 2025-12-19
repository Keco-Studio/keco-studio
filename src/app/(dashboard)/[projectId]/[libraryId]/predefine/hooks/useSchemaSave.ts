import type { SectionConfig } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

interface FieldDefinitionRow {
  id: string;
  library_id: string;
  section: string;
  label: string;
  data_type: string;
  enum_options: string[] | null;
  required: boolean;
  order_index: number;
}

/**
 * Incrementally update field definitions to preserve field IDs
 * This ensures asset values referencing field_id remain valid
 */
export async function saveSchemaIncremental(
  supabase: SupabaseClient,
  libraryId: string,
  sectionsToSave: SectionConfig[]
): Promise<void> {
  // Load existing definitions
  const { data: existingRows, error: fetchError } = await supabase
    .from('library_field_definitions')
    .select('*')
    .eq('library_id', libraryId);

  if (fetchError) throw fetchError;

  const existing = (existingRows || []) as FieldDefinitionRow[];
  const existingMap = new Map<string, FieldDefinitionRow>();
  existing.forEach((row) => {
    const key = `${row.section}|${row.label}`;
    existingMap.set(key, row);
  });

  // Build maps for new definitions
  const newMap = new Map<string, { section: string; label: string; data_type: string; enum_options: string[] | null; required: boolean; order_index: number }>();
  const sectionsToKeep = new Set<string>();

  sectionsToSave.forEach((section, sectionIdx) => {
    sectionsToKeep.add(section.name);
    section.fields.forEach((field, fieldIdx) => {
      const key = `${section.name}|${field.label}`;
      newMap.set(key, {
        section: section.name,
        label: field.label,
        data_type: field.dataType,
        enum_options: field.dataType === 'enum' ? field.enumOptions ?? [] : null,
        required: field.required,
        order_index: sectionIdx * 1000 + fieldIdx,
      });
    });
  });

  // Find fields to update, insert, and delete
  const toUpdate: FieldDefinitionRow[] = [];
  const toInsert: Omit<FieldDefinitionRow, 'id'>[] = [];
  const toDelete: string[] = [];

  // Check existing fields
  existing.forEach((row) => {
    const key = `${row.section}|${row.label}`;
    const newDef = newMap.get(key);

    if (newDef) {
      // Field exists, check if needs update
      if (
        row.data_type !== newDef.data_type ||
        JSON.stringify(row.enum_options) !== JSON.stringify(newDef.enum_options) ||
        row.required !== newDef.required ||
        row.order_index !== newDef.order_index
      ) {
        toUpdate.push({
          ...row,
          data_type: newDef.data_type,
          enum_options: newDef.enum_options,
          required: newDef.required,
          order_index: newDef.order_index,
        });
      }
      // Remove from newMap to mark as processed
      newMap.delete(key);
    } else {
      // Field no longer exists in new schema
      toDelete.push(row.id);
    }
  });

  // Remaining items in newMap are new fields to insert
  newMap.forEach((def) => {
    toInsert.push({
      library_id: libraryId,
      section: def.section,
      label: def.label,
      data_type: def.data_type,
      enum_options: def.enum_options,
      required: def.required,
      order_index: def.order_index,
    });
  });

  // Delete fields that no longer exist
  if (toDelete.length > 0) {
    const { error: delError } = await supabase
      .from('library_field_definitions')
      .delete()
      .in('id', toDelete);
    if (delError) throw delError;
  }

  // Update existing fields
  for (const row of toUpdate) {
    const { error: updateError } = await supabase
      .from('library_field_definitions')
      .update({
        data_type: row.data_type,
        enum_options: row.enum_options,
        required: row.required,
        order_index: row.order_index,
      })
      .eq('id', row.id);
    if (updateError) throw updateError;
  }

  // Insert new fields
  if (toInsert.length > 0) {
    const { error: insertError } = await supabase
      .from('library_field_definitions')
      .insert(toInsert);
    if (insertError) throw insertError;
  }
}



