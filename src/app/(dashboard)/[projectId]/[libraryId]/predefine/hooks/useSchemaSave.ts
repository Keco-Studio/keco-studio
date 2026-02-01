import type { SectionConfig } from '@/app/(dashboard)/[projectId]/[libraryId]/predefine/types';
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
 * Check if an ID is a database UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
 * vs a temporary frontend ID (format: xxxxxxxx - 8 hex characters)
 */
function isDatabaseId(id: string): boolean {
  // UUID v4 format: 8-4-4-4-12 hex digits with hyphens
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Incrementally update field definitions to preserve field IDs
 * This ensures asset values referencing field_id remain valid
 * 
 * Key strategy:
 * 1. Use field.id as the unique identifier
 *    - Database UUIDs (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) = existing fields
 *    - Frontend temp IDs (format: xxxxxxxx) = new fields
 * 2. This preserves field IDs when fields are reordered
 * 3. Supports multiple empty fields (each has unique temp ID)
 * 4. Clear asset values when data_type changes
 */
export async function saveSchemaIncremental(
  supabase: SupabaseClient,
  libraryId: string,
  sectionsToSave: SectionConfig[]
): Promise<void> {
  // Load existing definitions from database
  const { data: existingRows, error: fetchError } = await supabase
    .from('library_field_definitions')
    .select('*')
    .eq('library_id', libraryId);

  if (fetchError) throw fetchError;

  const existing = (existingRows || []) as FieldDefinitionRow[];
  
  // Map existing fields by their database ID for quick lookup
  const existingByIdMap = new Map<string, FieldDefinitionRow>();
  existing.forEach((row) => {
    existingByIdMap.set(row.id, row);
  });

  // Track all field IDs that are being kept (to identify deletions)
  const keptFieldIds = new Set<string>();
  
  // Prepare lists for database operations
  const toUpdate: FieldDefinitionRow[] = [];
  const toInsert: Omit<FieldDefinitionRow, 'id'>[] = [];
  const fieldsToClearValues: string[] = []; // Track fields whose data_type changed

  // Process all fields in the new schema
  sectionsToSave.forEach((section, sectionIdx) => {
    section.fields.forEach((field, fieldIdx) => {
      const orderIndex = sectionIdx * 1000 + fieldIdx;
      
      // Check if this is an existing field (database UUID) or new field (temp ID)
      if (isDatabaseId(field.id)) {
        // Existing field - update it
        const existingField = existingByIdMap.get(field.id);
        
        if (existingField) {
          // Field exists in database, mark it as kept
          keptFieldIds.add(field.id);
          
          // Check what changed
          const dataTypeChanged = existingField.data_type !== (field.dataType ?? null);
          const sectionChanged = existingField.section !== section.name;
          const labelChanged = existingField.label !== field.label;
          const enumOptionsChanged = JSON.stringify(existingField.enum_options) !== JSON.stringify(field.dataType === 'enum' ? field.enumOptions ?? [] : null);
          const referenceLibrariesChanged = JSON.stringify(existingField.reference_libraries) !== JSON.stringify(field.dataType === 'reference' ? field.referenceLibraries ?? [] : null);
          const requiredChanged = existingField.required !== field.required;
          const orderChanged = existingField.order_index !== orderIndex;
          
          // Update if anything changed
          if (dataTypeChanged || sectionChanged || labelChanged || enumOptionsChanged || referenceLibrariesChanged || requiredChanged || orderChanged) {
            toUpdate.push({
              ...existingField,
              section_id: section.id,
              section: section.name,
              label: field.label,
              data_type: field.dataType ?? null,
              enum_options: field.dataType === 'enum' ? field.enumOptions ?? [] : null,
              reference_libraries: field.dataType === 'reference' ? field.referenceLibraries ?? [] : null,
              required: field.required,
              order_index: orderIndex,
            });
            
            // If data type changed, mark this field's values for deletion
            if (dataTypeChanged) {
              fieldsToClearValues.push(field.id);
            }
          }
        } else {
          // Field ID is a UUID but not found in database (shouldn't happen, but handle it)
          // Treat as new field
          toInsert.push({
            library_id: libraryId,
            section_id: section.id,
            section: section.name,
            label: field.label,
            data_type: field.dataType ?? null,
            enum_options: field.dataType === 'enum' ? field.enumOptions ?? [] : null,
            reference_libraries: field.dataType === 'reference' ? field.referenceLibraries ?? [] : null,
            required: field.required,
            order_index: orderIndex,
          });
        }
      } else {
        // New field (temp ID from frontend) - insert it
        toInsert.push({
          library_id: libraryId,
          section_id: section.id,
          section: section.name,
          label: field.label,
          data_type: field.dataType ?? null,
          enum_options: field.dataType === 'enum' ? field.enumOptions ?? [] : null,
          reference_libraries: field.dataType === 'reference' ? field.referenceLibraries ?? [] : null,
          required: field.required,
          order_index: orderIndex,
        });
      }
    });
  });

  // Find fields to delete (exist in database but not in new schema)
  const toDelete: string[] = [];
  existing.forEach((row) => {
    if (!keptFieldIds.has(row.id)) {
      toDelete.push(row.id);
    }
  });

  // Execute database operations in order
  
  // Step 1: Clear asset values for fields whose data_type changed
  if (fieldsToClearValues.length > 0) {
    console.log('[saveSchemaIncremental] Clearing asset values for fields:', fieldsToClearValues);
    const { error: clearError } = await supabase
      .from('library_asset_values')
      .delete()
      .in('field_id', fieldsToClearValues);
    if (clearError) {
      console.error('[saveSchemaIncremental] Error clearing asset values:', clearError);
      throw clearError;
    }
    console.log('[saveSchemaIncremental] Successfully cleared asset values');
    
    // Clear IndexedDB cache for this library to force reload of fresh data
    // This ensures LibraryDataContext gets the updated data without stale cached values
  }

  // Step 2: Delete fields that no longer exist
  if (toDelete.length > 0) {
    const { error: delError } = await supabase
      .from('library_field_definitions')
      .delete()
      .in('id', toDelete);
    if (delError) throw delError;
  }

  // Step 3: Update existing fields (two-phase update to avoid unique constraint conflicts)
  // Phase 3a: Set all order_index values to temporary negative values
  // This avoids conflicts with the unique(section_id, order_index) constraint
  if (toUpdate.length > 0) {
    for (let i = 0; i < toUpdate.length; i++) {
      const row = toUpdate[i];
      const { error: tempUpdateError } = await supabase
        .from('library_field_definitions')
        .update({
          order_index: -(i + 1), // Use negative temporary values
        })
        .eq('id', row.id);
      if (tempUpdateError) throw tempUpdateError;
    }
    
    // Phase 3b: Update all fields with their final values
    for (const row of toUpdate) {
      const { error: updateError } = await supabase
        .from('library_field_definitions')
        .update({
          section_id: row.section_id,
          section: row.section,
          label: row.label,
          data_type: row.data_type,
          enum_options: row.enum_options,
          reference_libraries: row.reference_libraries,
          required: row.required,
          order_index: row.order_index,
        })
        .eq('id', row.id);
      if (updateError) throw updateError;
    }
  }

  // Step 4: Insert new fields
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



