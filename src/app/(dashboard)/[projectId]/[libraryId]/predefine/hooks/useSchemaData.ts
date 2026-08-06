'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { FieldConfig, FieldType } from '@/app/(dashboard)/[projectId]/[libraryId]/predefine/types';
import type { SupabaseClient } from '@supabase/supabase-js';

interface UseSchemaDataProps {
  libraryId: string | undefined;
  supabase: SupabaseClient;
}

export function useSchemaData({ libraryId, supabase }: UseSchemaDataProps) {
  const [fields, setFields] = useState<FieldConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = React.useRef(false);

  const reload = useCallback(async () => {
    if (!libraryId || loadingRef.current) return [];
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('library_field_definitions')
        .select('*')
        .eq('library_id', libraryId)
        .order('order_index', { ascending: true })
        .order('id', { ascending: true });
      if (fetchError) throw fetchError;
      const loaded = ((data ?? []) as Array<{
        id: string;
        label: string;
        description: string | null;
        data_type: FieldType;
        required: boolean;
        enum_options: string[] | null;
        reference_libraries: string[] | null;
      }>).map((row) => ({
        id: row.id,
        label: row.label,
        description: row.description,
        dataType: row.data_type === ('media' as FieldType) ? 'image' : row.data_type,
        required: row.required,
        enumOptions: row.data_type === 'enum' ? row.enum_options ?? [] : undefined,
        referenceLibraries: row.data_type === 'reference' ? row.reference_libraries ?? [] : undefined,
      }));
      setFields(loaded);
      return loaded;
    } catch (e: any) {
      const message = e?.message || 'Failed to load existing definitions';
      setError(message);
      throw e;
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [libraryId, supabase]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { fields, setFields, loading, error, reload };
}
