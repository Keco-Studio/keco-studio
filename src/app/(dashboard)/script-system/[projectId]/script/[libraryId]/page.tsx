'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { queryKeys } from '@/lib/utils/queryKeys';
import { getLibrary } from '@/lib/services/libraryService';
import {
  getLibraryAssetsWithProperties,
  getLibrarySchema,
} from '@/lib/services/libraryAssetsService';
import {
  buildPropertyGroups,
  detectScriptColumns,
} from '@/components/libraries/utils/tableStructure';
import { useScriptWorkspaceMembership } from '@/components/script-system/useScriptWorkspaceMembership';
import { ScriptSplitView } from '@/components/script-system/ScriptSplitView';
import { showErrorToast } from '@/lib/utils/toast';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

function assetRowsToFlowRecords(
  rows: AssetRow[],
  properties: PropertyConfig[]
): Array<Record<string, string>> {
  return rows.map((row) => {
    const record: Record<string, string> = {};
    for (const property of properties) {
      const raw = row.propertyValues?.[property.key];
      record[property.name] =
        raw == null ? '' : typeof raw === 'string' ? raw : String(raw);
    }
    return record;
  });
}

export default function ScriptLibraryPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = useSupabase();
  const projectId = params.projectId as string;
  const libraryId = params.libraryId as string;
  const { isMember, isLoading, isFetching, isFetched, isError } =
    useScriptWorkspaceMembership(projectId);
  const handledRef = useRef(false);

  const {
    data: library,
    isLoading: libraryLoading,
    isFetched: libraryFetched,
    isError: libraryError,
  } = useQuery({
    queryKey: queryKeys.library(libraryId),
    queryFn: () => getLibrary(supabase, libraryId, projectId),
    enabled: Boolean(libraryId && projectId),
  });

  const { data: librarySchema, isLoading: schemaLoading } = useQuery({
    queryKey: queryKeys.librarySchema(libraryId),
    queryFn: () => getLibrarySchema(supabase, libraryId),
    enabled: Boolean(libraryId),
  });

  const { data: assetRows = [], isLoading: assetsLoading } = useQuery({
    queryKey: queryKeys.libraryAssets(libraryId),
    queryFn: () => getLibraryAssetsWithProperties(supabase, libraryId),
    enabled: Boolean(libraryId),
  });

  const membershipSettled = isFetched && !isLoading && !isFetching;
  const sourceDocumentId = library?.source_document_id ?? null;
  const isScriptLibrary = library?.document_export_type === 'script';
  const inWorkspace =
    Boolean(sourceDocumentId) && isMember(sourceDocumentId as string);

  const allowed =
    membershipSettled &&
    libraryFetched &&
    !isError &&
    !libraryError &&
    Boolean(library) &&
    isScriptLibrary &&
    inWorkspace;

  useEffect(() => {
    if (!membershipSettled || !libraryFetched || handledRef.current) return;

    if (isError || libraryError || !library) {
      handledRef.current = true;
      showErrorToast('Failed to open script library');
      router.replace(`/script-system/${projectId}`);
      return;
    }

    if (
      library.document_export_type !== 'script' ||
      !library.source_document_id ||
      !isMember(library.source_document_id)
    ) {
      handledRef.current = true;
      showErrorToast('This script is not available in the Script workspace');
      router.replace(`/script-system/${projectId}`);
    }
  }, [
    membershipSettled,
    libraryFetched,
    isError,
    libraryError,
    library,
    isMember,
    projectId,
    router,
  ]);

  const properties = librarySchema?.properties ?? [];
  const sections = librarySchema?.sections ?? [];

  const { scriptColumns } = useMemo(() => {
    const { orderedProperties } = buildPropertyGroups(sections, properties);
    return detectScriptColumns(orderedProperties);
  }, [sections, properties]);

  const flowRows = useMemo(
    () => assetRowsToFlowRecords(assetRows, properties),
    [assetRows, properties]
  );

  if (!allowed || schemaLoading || assetsLoading || libraryLoading) {
    return null;
  }

  return (
    <ScriptSplitView
      libraryName={library?.name ?? 'Script'}
      rows={assetRows}
      scriptColumns={scriptColumns}
      flowRows={flowRows}
    />
  );
}
