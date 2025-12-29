import { useState, useEffect, useCallback } from 'react';
import type { SectionConfig, FieldType } from '../types';
import { uid } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

interface UseSchemaDataProps {
  libraryId: string | undefined;
  supabase: SupabaseClient;
}

export function useSchemaData({ libraryId, supabase }: UseSchemaDataProps) {
  const [sections, setSections] = useState<SectionConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSections = useCallback(async () => {
    if (!libraryId) return;

    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('library_field_definitions')
        .select('*')
        .eq('library_id', libraryId)
        .order('section', { ascending: true })
        .order('order_index', { ascending: true });

      if (fetchError) throw fetchError;

      const rows = (data || []) as {
        id: string;
        section: string;
        label: string;
        data_type: FieldType;
        required: boolean;
        enum_options: string[] | null;
        reference_libraries: string[] | null;
        order_index: number;
      }[];

      // Group by section name and track minimum order_index for each section
      const sectionMap = new Map<string, { section: SectionConfig; minOrderIndex: number }>();

      rows.forEach((row) => {
        const sectionName = row.section;
        if (!sectionMap.has(sectionName)) {
          sectionMap.set(sectionName, {
            section: {
              id: uid(),
              name: sectionName,
              fields: [],
            },
            minOrderIndex: row.order_index,
          });
        } else {
          const grouped = sectionMap.get(sectionName)!;
          if (row.order_index < grouped.minOrderIndex) {
            grouped.minOrderIndex = row.order_index;
          }
        }
        const grouped = sectionMap.get(sectionName)!;
        
        // Migrate legacy 'media' type to 'image' for backward compatibility
        let dataType = row.data_type;
        if (dataType === 'media' as any) {
          dataType = 'image' as FieldType;
        }
        
        const field = {
          id: row.id,
          label: row.label,
          dataType: dataType,
          required: row.required,
          enumOptions: dataType === 'enum' ? row.enum_options ?? [] : undefined,
          referenceLibraries: dataType === 'reference' ? row.reference_libraries ?? [] : undefined,
        };
        grouped.section.fields.push(field);
      });

      // Sort sections by their minimum order_index
      const loadedSections = Array.from(sectionMap.values())
        .sort((a, b) => a.minOrderIndex - b.minOrderIndex)
        .map((entry) => entry.section);
      
      setSections(loadedSections);
      return loadedSections;
    } catch (e: any) {
      const errorMessage = e?.message || 'Failed to load existing definitions';
      setError(errorMessage);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [libraryId, supabase]);

  useEffect(() => {
    void loadSections();
  }, [loadSections]);

  return { sections, setSections, loading, error, reload: loadSections };
}

