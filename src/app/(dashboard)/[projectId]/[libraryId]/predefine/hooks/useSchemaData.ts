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
        section: string;
        label: string;
        data_type: FieldType;
        required: boolean;
        enum_options: string[] | null;
      }[];

      // Group by section name
      const sectionMap = new Map<string, SectionConfig>();

      rows.forEach((row) => {
        const sectionName = row.section;
        if (!sectionMap.has(sectionName)) {
          sectionMap.set(sectionName, {
            id: uid(),
            name: sectionName,
            fields: [],
          });
        }
        const section = sectionMap.get(sectionName)!;
        const field = {
          id: uid(),
          label: row.label,
          dataType: row.data_type,
          required: row.required,
          enumOptions: row.data_type === 'enum' ? row.enum_options ?? [] : undefined,
        };
        section.fields.push(field);
      });

      const loadedSections = Array.from(sectionMap.values());
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

