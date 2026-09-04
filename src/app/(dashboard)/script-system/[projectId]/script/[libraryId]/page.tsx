'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { queryKeys } from '@/lib/utils/queryKeys';
import { getLibrary } from '@/lib/services/libraryService';
import {
  getLibraryAssetsWithProperties,
  getLibrarySchema,
} from '@/lib/services/libraryAssetsService';
import { detectScriptColumns, orderProperties } from '@/components/libraries/utils/tableStructure';
import { useScriptWorkspaceMembership } from '@/components/script-system/useScriptWorkspaceMembership';
import { ScriptSplitView } from '@/components/script-system/ScriptSplitView';
import { showErrorToast } from '@/lib/utils/toast';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { buildPersistedPlotGraph } from '@/lib/script-system/buildPersistedPlotGraph';
import {
  displayScriptFlowGraph,
  type FlowGraph,
} from '@/lib/script-system/buildScriptFlowGraph';
import {
  applyFlowGraphTitles,
  chaptersFromScriptView,
  flowGraphNeedsAiTitles,
} from '@/lib/script-system/plotTitleDisplay';
import { summarizeScriptPlotTitlesClient } from '@/lib/script-system/scriptPlotTitleClient';

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

  const {
    data: librarySchema,
    isLoading: schemaLoading,
    isFetched: schemaFetched,
    isError: schemaError,
  } = useQuery({
    queryKey: queryKeys.librarySchema(libraryId),
    queryFn: () => getLibrarySchema(supabase, libraryId),
    enabled: Boolean(libraryId),
  });

  const {
    data: assetRows = [],
    isLoading: assetsLoading,
    isFetched: assetsFetched,
    isError: assetsError,
  } = useQuery({
    queryKey: queryKeys.libraryAssets(libraryId),
    queryFn: () => getLibraryAssetsWithProperties(supabase, libraryId),
    enabled: Boolean(libraryId),
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const sourceDocumentId = library?.source_document_id ?? null;

  const { data: sourceState } = useQuery({
    queryKey: sourceDocumentId ? queryKeys.documentState(sourceDocumentId) : ['script-source-state', libraryId],
    queryFn: async () => {
      if (!sourceDocumentId) return null;
      const { data, error } = await supabase
        .from('documents')
        .select('collab_epoch, collab_revision')
        .eq('id', sourceDocumentId)
        .single();
      if (error || !data) throw new Error('Failed to load source document state');
      return {
        token: {
          epoch: Number(data.collab_epoch),
          revision: Number(data.collab_revision),
        },
      };
    },
    enabled: Boolean(sourceDocumentId),
  });

  // First-load ready: keep rendering during background refetch once we have data.
  const membershipReady = isFetched && !isLoading;
  // Settled: only treat non-membership as final after refetch completes.
  const membershipSettled = membershipReady && !isFetching;
  const assetsSchemaSettled = schemaFetched && assetsFetched;
  const isScriptLibrary = library?.document_export_type === 'script';
  const inWorkspace =
    Boolean(sourceDocumentId) && isMember(sourceDocumentId as string);

  const canRender =
    membershipReady &&
    libraryFetched &&
    assetsSchemaSettled &&
    !isError &&
    !libraryError &&
    !schemaError &&
    !assetsError &&
    Boolean(library) &&
    isScriptLibrary &&
    Boolean(sourceState) &&
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
      return;
    }

    if (!assetsSchemaSettled) return;

    if (schemaError || assetsError) {
      handledRef.current = true;
      showErrorToast('Failed to open script library');
      router.replace(`/script-system/${projectId}`);
    }
  }, [
    membershipSettled,
    libraryFetched,
    assetsSchemaSettled,
    isError,
    libraryError,
    schemaError,
    assetsError,
    library,
    isMember,
    projectId,
    router,
  ]);

  const properties = useMemo(
    () => librarySchema?.properties ?? [],
    [librarySchema?.properties]
  );
  const { scriptColumns } = useMemo(() => {
    return detectScriptColumns(orderProperties(properties));
  }, [properties]);

  const flowRows = useMemo(
    () => assetRowsToFlowRecords(assetRows, properties),
    [assetRows, properties]
  );
  const persistedGraph = useMemo(
    () => buildPersistedPlotGraph(library?.plot_plan, assetRows.length),
    [assetRows.length, library?.plot_plan]
  );
  const baseGraph = useMemo(
    () => displayScriptFlowGraph(persistedGraph, flowRows),
    [flowRows, persistedGraph]
  );
  const needsAiTitles = useMemo(
    () => flowGraphNeedsAiTitles(baseGraph, assetRows, flowRows, scriptColumns.contentKey),
    [assetRows, baseGraph, flowRows, scriptColumns.contentKey]
  );
  const titleWaitKey = `${libraryId}:${baseGraph.nodes.map((node) => `${node.id}:${node.rowIndexes.join('.')}`).join('|')}`;
  const [aiReady, setAiReady] = useState<{ key: string; graph: FlowGraph } | null>(null);
  const dataReady =
    canRender &&
    !schemaLoading &&
    !assetsLoading &&
    !libraryLoading &&
    assetsSchemaSettled;

  useEffect(() => {
    if (!dataReady || !needsAiTitles) return;
    let cancelled = false;
    let attempts = 0;
    let graph = baseGraph;
    const finish = (next: FlowGraph) => {
      if (!cancelled) setAiReady({ key: titleWaitKey, graph: next });
    };
    const run = () => {
      attempts += 1;
      const chapters = chaptersFromScriptView(
        graph,
        assetRows,
        flowRows,
        scriptColumns.contentKey,
      );
      summarizeScriptPlotTitlesClient({ projectId, libraryId, chapters })
        .then((result) => {
          if (cancelled) return;
          graph = applyFlowGraphTitles(
            graph,
            result.titles,
            assetRows,
            flowRows,
            scriptColumns.contentKey,
          );
          if (!flowGraphNeedsAiTitles(graph, assetRows, flowRows, scriptColumns.contentKey)) {
            finish(graph);
            return;
          }
          if (attempts < 3) run();
          else finish(graph);
        })
        .catch(() => {
          if (cancelled) return;
          if (attempts < 3) run();
          else finish(baseGraph);
        });
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [
    assetRows,
    baseGraph,
    dataReady,
    flowRows,
    libraryId,
    needsAiTitles,
    projectId,
    scriptColumns.contentKey,
    titleWaitKey,
  ]);

  // Always open the split view on the deterministic graph. AI titles refresh in
  // place when ready so missing LLM credentials cannot blank the Flow chart.
  const openingGraph = aiReady?.key === titleWaitKey ? aiReady.graph : baseGraph;
  const openingKey = aiReady?.key === titleWaitKey ? `titled:${titleWaitKey}` : `base:${titleWaitKey}`;

  if (!dataReady) {
    return null;
  }

  return (
    <ScriptSplitView
      key={openingKey}
      libraryId={libraryId}
      rows={assetRows}
      scriptColumns={scriptColumns}
      flowRows={flowRows}
      persistedGraph={openingGraph}
      supabase={supabase}
      projectId={projectId}
      sourceDocumentId={sourceDocumentId}
      sourceToken={sourceState?.token ?? null}
    />
  );
}
