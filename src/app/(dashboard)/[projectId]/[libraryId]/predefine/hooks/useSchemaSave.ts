import type { SectionConfig } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

interface FieldDefinitionRow {
  id: string;
  library_id: string;
  section_id: string;
  section: string;
  label: string;
  data_type: string | null; // Allow null for flexible field types
  enum_options: string[] | null;
  reference_libraries: string[] | null;
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
    // Use section_id + order_index as key for matching (unique within a section)
    const key = `${row.section_id}|${row.order_index}`;
    existingMap.set(key, row);
  });

  // Build maps for new definitions
  const newMap = new Map<string, { section_id: string; section: string; label: string; data_type: string | null; enum_options: string[] | null; reference_libraries: string[] | null; required: boolean; order_index: number }>();
  const sectionsToKeep = new Set<string>();

  sectionsToSave.forEach((section, sectionIdx) => {
    sectionsToKeep.add(section.id); // Use section.id instead of section.name
    section.fields.forEach((field, fieldIdx) => {
      // Use section_id + order_index as key (unique within a section)
      const orderIndex = sectionIdx * 1000 + fieldIdx;
      const key = `${section.id}|${orderIndex}`;
      newMap.set(key, {
        section_id: section.id, // Store section ID
        section: section.name, // Store section name for display
        label: field.label,
        data_type: field.dataType ?? null, // Convert undefined to null for database
        enum_options: field.dataType === 'enum' ? field.enumOptions ?? [] : null,
        reference_libraries: field.dataType === 'reference' ? field.referenceLibraries ?? [] : null,
        required: field.required,
        order_index: orderIndex,
      });
    });
  });

  // Find fields to update, insert, and delete
  const toUpdate: FieldDefinitionRow[] = [];
  const toInsert: Omit<FieldDefinitionRow, 'id'>[] = []; // Let database generate UUID for id
  const toDelete: string[] = [];

  // Check existing fields
  existing.forEach((row) => {
    const key = `${row.section_id}|${row.order_index}`;
    const newDef = newMap.get(key);

    if (newDef) {
      // Field exists at this position, check if needs update
      if (
        row.section !== newDef.section ||
        row.label !== newDef.label ||
        row.data_type !== newDef.data_type ||
        JSON.stringify(row.enum_options) !== JSON.stringify(newDef.enum_options) ||
        JSON.stringify(row.reference_libraries) !== JSON.stringify(newDef.reference_libraries) ||
        row.required !== newDef.required
      ) {
        toUpdate.push({
          ...row,
          section: newDef.section, // Update section name if changed
          label: newDef.label, // Update label if changed
          data_type: newDef.data_type,
          enum_options: newDef.enum_options,
          reference_libraries: newDef.reference_libraries,
          required: newDef.required,
          order_index: newDef.order_index,
        });
      }
      // Remove from newMap to mark as processed
      newMap.delete(key);
    } else {
      // Field no longer exists at this position (deleted or moved)
      toDelete.push(row.id);
    }
  });

  // Remaining items in newMap are new fields to insert
  newMap.forEach((def) => {
    toInsert.push({
      library_id: libraryId,
      section_id: def.section_id, // Include section_id
      section: def.section,
      label: def.label,
      data_type: def.data_type,
      enum_options: def.enum_options,
      reference_libraries: def.reference_libraries,
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
        section: row.section, // Update section name if changed
        label: row.label, // Update label if changed
        data_type: row.data_type,
        enum_options: row.enum_options,
        reference_libraries: row.reference_libraries,
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
  
  // Invalidate cache after successful save
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  globalRequestCache.invalidate(`field-definitions:${libraryId}`);
}



