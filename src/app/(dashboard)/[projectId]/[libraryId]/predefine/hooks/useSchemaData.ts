'use client';
import React, { useState, useEffect, useCallback } from 'react';
import type { SectionConfig, FieldType } from '../types';
import { uid } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

interface UseSchemaDataProps {
  libraryId: string | undefined;
  supabase: SupabaseClient;
}

export function useSchemaData({ libraryId, supabase }: UseSchemaDataProps) {
  const [sections, setSections] = useState<SectionConfig[]>([]);
  const [loading, setLoading] = useState(true); // Start with true to prevent flash
  const [error, setError] = useState<string | null>(null);
  
  // Use ref to track ongoing requests and prevent duplicates
  const loadingRef = React.useRef(false);

  const loadSections = useCallback(async () => {
    if (!libraryId) return;
    
    // Prevent duplicate concurrent requests
    if (loadingRef.current) {
      return;
    }

    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      // Use cache to prevent duplicate requests
      const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
      const cacheKey = `field-definitions:${libraryId}`;
      
      const data = await globalRequestCache.fetch(cacheKey, async () => {
        const { data, error: fetchError } = await supabase
          .from('library_field_definitions')
          .select('*')
          .eq('library_id', libraryId)
          .order('section', { ascending: true })
          .order('order_index', { ascending: true });

        if (fetchError) throw fetchError;
        return data || [];
      });

      if (!data) {
        throw new Error('Failed to load field definitions');
      }

      const rows = (data || []) as {
        id: string;
        section_id: string;
        section: string;
        label: string;
        data_type: FieldType;
        required: boolean;
        enum_options: string[] | null;
        reference_libraries: string[] | null;
        order_index: number;
      }[];

      // Group by section_id (stable identifier) and track minimum order_index for each section
      const sectionMap = new Map<string, { section: SectionConfig; minOrderIndex: number }>();

      rows.forEach((row) => {
        const sectionId = row.section_id;
        const sectionName = row.section;
        if (!sectionMap.has(sectionId)) {
          sectionMap.set(sectionId, {
            section: {
              id: sectionId, // Use section_id from database as the stable ID
              name: sectionName,
              fields: [],
            },
            minOrderIndex: row.order_index,
          });
        } else {
          const grouped = sectionMap.get(sectionId)!;
          // Update section name in case it was changed
          grouped.section.name = sectionName;
          if (row.order_index < grouped.minOrderIndex) {
            grouped.minOrderIndex = row.order_index;
          }
        }
        const grouped = sectionMap.get(sectionId)!;
        
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
      loadingRef.current = false;
    }
  }, [libraryId, supabase]);

  useEffect(() => {
    void loadSections();
  }, [loadSections]);

  return { sections, setSections, loading, error, reload: loadSections };
}

