'use client';

import { CloseOutlined } from '@ant-design/icons';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SelectDocumentModal } from '@/components/script-system/SelectDocumentModal';
import { parseDocument, validateDesignFile } from '@/lib/document-parser';
import { useSupabase } from '@/lib/SupabaseContext';
import { createMapAgentRefreshKey, type CreateMapAgentRefresh } from '@/lib/create-map/agentRefresh';
import { DirectMapCanvas, type DirectMapCanvasImage } from './components/DirectMapCanvas';
import { DirectMapGenerationPanel } from './components/DirectMapGenerationPanel';
import { DirectMapCollisionPanel } from './components/DirectMapCollisionPanel';
import { DirectMapPlanInspector } from './components/DirectMapPlanInspector';
import { MapChatPanel, type MapChatMessage, type MapGenerationHistoryEntry } from './components/MapChatPanel';
import { MapReferencePanel } from './components/MapReferencePanel';
import { MapSourcePanel } from './components/MapSourcePanel';
import { SavedMapsPanel } from './components/SavedMapsPanel';
import {
  createMapDraftAdapterV3,
  useMapDraft,
} from './hooks/useMapDraft';
import {
  savedPlanSelectionIsCurrent,
  useDirectMapGeneration,
  type SavedPlanSelection,
} from './hooks/useDirectMapGeneration';
import { useDirectMapCollisionGrid } from './hooks/useDirectMapCollisionGrid';
import { useMapSources } from './hooks/useMapSources';
import { useMapGenerationHistory } from './hooks/useMapGenerationHistory';
import { savedMapOpenIsCurrent, savedMapSwitchBlocked, useSavedMaps } from './hooks/useSavedMaps';
import {
  containsUnsafeDescriptionContent,
  DIRECT_MAP_UNSAFE_DESCRIPTION_MESSAGE,
  createEmptyMapSceneV3,
  validateMapPlanV3,
  type MapPlanV3,
  type MapSceneV3,
} from './model/directMapSchema';
import { mapVersionLabelForRevision } from './model/mapVersionLabel';
import {
  createMapService,
  type MapDraftIdentity,
  type MapReferenceRecord,
  type MapVersionWorkspaceV3,
  type SavedMapSummary,
} from './services/createMapService';
import {
  readCreateMapProjectPreference,
  CREATE_MAP_SIDEBAR_STATE_EVENT,
  CREATE_MAP_TOOLBAR_CREATE_EVENT,
} from '@/lib/create-map/projectPreference';
import styles from './CreateMapWorkbench.module.css';

const INITIAL_DIRECT_PLAN: MapPlanV3 = {
  schemaVersion: 3,
  name: 'Untitled direct map',
  summary: 'A complete top-down map generated as one opaque image.',
  map: { width: 512, height: 512 },
  description: 'An opaque top-down pixel art village map with readable roads, natural terrain, clear building footprints, and no interface text.',
  references: [],
  styleReference: null,
  generation: {
    provider: 'pixellab',
    operation: 'create_image_pro',
    noBackground: false,
    seed: null,
  },
};

function nextMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sameDraftRevision(left: MapDraftIdentity | null, right: MapDraftIdentity | null): boolean {
  return Boolean(left && right
    && left.mapId === right.mapId
    && left.revisionId === right.revisionId);
}

export function savedPlanResponseIsCurrent(
  requestPayloadKey: string,
  settledDraft: MapDraftIdentity,
  saved: SavedPlanSelection,
  current: { identity: MapDraftIdentity | null; payloadKey: string },
): boolean {
  return current.payloadKey === requestPayloadKey
    && sameDraftRevision(current.identity, settledDraft)
    && saved.draftRevisionId === settledDraft.revisionId
    && saved.draftSaveVersion === settledDraft.saveVersion;
}

export function DirectMapWorkbench() {
  const searchParams = useSearchParams();
  const requestedMapId = searchParams?.get('mapId') ?? null;
  const readOnly = searchParams?.get('viewer') === '1';
  const supabase = useSupabase();
  const service = useMemo(() => createMapService(supabase), [supabase]);
  const adapter = useMemo(() => createMapDraftAdapterV3(service), [service]);
  const [plan, setPlan] = useState(INITIAL_DIRECT_PLAN);
  const [scene, setScene] = useState<MapSceneV3>(() => createEmptyMapSceneV3(INITIAL_DIRECT_PLAN));
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [documentName, setDocumentName] = useState('');
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false);
  const [references, setReferences] = useState<MapReferenceRecord[]>([]);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [operation, setOperation] = useState<'idle' | 'planning' | 'opening'>('idle');
  const [openingMapId, setOpeningMapId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'browse' | 'detail'>('browse');
  const [chatMessages, setChatMessages] = useState<MapChatMessage[]>([]);
  const [planDetailsOpen, setPlanDetailsOpen] = useState(false);
  const [savedPlanSelection, setSavedPlanSelection] = useState<SavedPlanSelection | null>(null);
  const [planSavePending, setPlanSavePending] = useState(false);
  const [historicalWorkspace, setHistoricalWorkspace] = useState<MapVersionWorkspaceV3 | null>(null);
  const openRequestEpoch = useRef(0);
  const historicalSelectionEpoch = useRef(0);
  const referenceRequestEpoch = useRef(0);
  const openedRequestedMapId = useRef<string | null>(null);
  const previousGenerationPhase = useRef<string>('idle');
  const planSaveEpoch = useRef(0);
  const planSaveActive = useRef(false);
  const invalidateHistoricalSelection = useCallback(() => {
    historicalSelectionEpoch.current += 1;
    setHistoricalWorkspace(null);
  }, []);
  const pendingRefresh = useRef<{ projectId: string; mapId?: string } | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const { data: agentRefresh } = useQuery<CreateMapAgentRefresh | null>({
    queryKey: createMapAgentRefreshKey,
    queryFn: async () => null,
    enabled: false,
    initialData: null,
  });

  const sources = useMapSources(projectId);
  const savedMaps = useSavedMaps();
  const draft = useMapDraft(plan, scene, adapter);
  const draftPayloadKey = useMemo(() => JSON.stringify({ plan, scene }), [plan, scene]);
  const savedPlanPayloadKey = useRef<string | null>(null);
  const currentDraft = useRef({ identity: draft.identity, payloadKey: draftPayloadKey });
  currentDraft.current = { identity: draft.identity, payloadKey: draftPayloadKey };
  const hasCurrentSavedPlan = savedPlanSelectionIsCurrent(savedPlanSelection, draft.identity)
    && savedPlanPayloadKey.current === draftPayloadKey;
  const mapGenerationHistory = useMapGenerationHistory(draft.identity?.mapId ?? null);
  const generation = useDirectMapGeneration({
    projectId,
    plan,
    scene,
    canPrepare: Boolean(draft.identity) && draft.status === 'saved' && !draft.isDirty && draft.isValid && hasCurrentSavedPlan,
    draftIdentity: draft.identity,
    savedPlanSelection: hasCurrentSavedPlan ? savedPlanSelection : null,
    reloadDraftAfterPreparation: draft.reload,
    onSceneMaterialized: setScene,
  });
  const validation = useMemo(() => validateMapPlanV3(plan), [plan]);
  const busy = operation !== 'idle' || planSavePending || draft.status === 'creating' || draft.status === 'saving'
    || generation.phase === 'preparing' || generation.phase === 'submitting';
  const mapSwitchBlocked = savedMapSwitchBlocked(draft);
  const canGenerate = !readOnly && !historicalWorkspace && Boolean(draft.identity) && validation.success && draft.isValid
    && !draft.isDirty && draft.status === 'saved' && hasCurrentSavedPlan && !busy;
  const historicalReadOnly = Boolean(historicalWorkspace);
  const workspaceReadOnly = readOnly || historicalReadOnly;

  useEffect(() => {
    if (!savedPlanSelection) return;
    if (!hasCurrentSavedPlan) {
      savedPlanPayloadKey.current = null;
      setSavedPlanSelection(null);
    }
  }, [hasCurrentSavedPlan, savedPlanSelection]);

  useEffect(() => {
    const preferred = readCreateMapProjectPreference();
    if (preferred?.projectId) setProjectId(preferred.projectId);
  }, []);

  useEffect(() => {
    const requestEpoch = ++referenceRequestEpoch.current;
    setReferenceError(null);
    if (!projectId) {
      setReferences([]);
      return;
    }
    void service.listReferences(projectId).then((next) => {
      if (referenceRequestEpoch.current === requestEpoch) setReferences(next);
    }).catch((cause) => {
      if (referenceRequestEpoch.current === requestEpoch) {
        setReferenceError(cause instanceof Error ? cause.message : 'Could not load map references.');
      }
    });
  }, [projectId, service]);

  useEffect(() => {
    if (previousGenerationPhase.current !== 'ready' && generation.phase === 'ready') {
      void mapGenerationHistory.refetch();
      setChatMessages((current) => {
        if (current.some((message) => message.text === 'Here is the created map')) return current;
        return [...current, { id: nextMessageId(), role: 'assistant', text: 'Here is the created map' }];
      });
    }
    previousGenerationPhase.current = generation.phase;
  }, [generation.phase, mapGenerationHistory]);

  const closeDrawers = useCallback(() => {
    setLeftOpen(false);
    setRightOpen(false);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(CREATE_MAP_SIDEBAR_STATE_EVENT, { detail: { collapsed: leftCollapsed } }));
  }, [leftCollapsed]);

  const toggleSourcePanel = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth < 900) {
      setLeftOpen((open) => !open);
      return;
    }
    setLeftCollapsed((collapsed) => !collapsed);
  }, []);

  useEffect(() => {
    window.addEventListener('sidebar-toggle', toggleSourcePanel);
    return () => window.removeEventListener('sidebar-toggle', toggleSourcePanel);
  }, [toggleSourcePanel]);

  const changePlan = useCallback((nextPlan: MapPlanV3) => {
    if (historicalWorkspace) return;
    if (scene.size.width !== nextPlan.map.width || scene.size.height !== nextPlan.map.height) {
      setScene(createEmptyMapSceneV3(nextPlan));
      generation.reset();
    }
    setPlan(nextPlan);
  }, [generation, historicalWorkspace, scene.size.height, scene.size.width]);

  const savePlan = useCallback(async () => {
    if (readOnly || historicalWorkspace || busy || planSaveActive.current) return;
    planSaveActive.current = true;
    const requestEpoch = ++planSaveEpoch.current;
    const requestPayloadKey = draftPayloadKey;
    setError(null);
    setPlanSavePending(true);
    try {
      const settledDraft = await draft.saveNow();
      if (!settledDraft) return;
      const saved = await service.savePlanV3(settledDraft, plan);
      const latest = currentDraft.current;
      if (requestEpoch !== planSaveEpoch.current
        || !savedPlanResponseIsCurrent(requestPayloadKey, settledDraft, saved, latest)) return;
      savedPlanPayloadKey.current = requestPayloadKey;
      setSavedPlanSelection({
        id: saved.id,
        versionNumber: saved.versionNumber,
        draftRevisionId: saved.draftRevisionId,
        draftSaveVersion: saved.draftSaveVersion,
      });
    } catch (cause) {
      if (requestEpoch === planSaveEpoch.current) {
        setError(cause instanceof Error ? cause.message : 'Could not save the map Plan.');
      }
    } finally {
      if (requestEpoch === planSaveEpoch.current) {
        planSaveActive.current = false;
        setPlanSavePending(false);
      }
    }
  }, [busy, draft, draftPayloadKey, historicalWorkspace, plan, readOnly, service]);

  const handleProjectChange = (nextProjectId: string) => {
    if (nextProjectId === projectId) return;
    openRequestEpoch.current += 1;
    setProjectId(nextProjectId);
    setDocumentId('');
    setDocumentName('');
    setPlan((current) => ({ ...current, references: [], styleReference: null }));
    draft.reset();
    generation.reset();
    setOpeningMapId(null);
    setError(null);
    setChatMessages([]);
    invalidateHistoricalSelection();
    setViewMode('browse');
  };

  const clearAttachedDocument = useCallback(() => {
    setDocumentId('');
    setDocumentName('');
  }, []);

  const enterCreateDetail = useCallback(() => {
    if (readOnly || historicalWorkspace) return;
    draft.reset();
    generation.reset();
    setPlan(INITIAL_DIRECT_PLAN);
    setScene(createEmptyMapSceneV3(INITIAL_DIRECT_PLAN));
    setDescription('');
    clearAttachedDocument();
    setChatMessages([]);
    invalidateHistoricalSelection();
    setError(null);
    setViewMode('detail');
    setPlanDetailsOpen(true);
    setRightOpen(true);
  }, [clearAttachedDocument, draft, generation, invalidateHistoricalSelection, readOnly]);

  useEffect(() => {
    const onToolbarCreate = () => {
      enterCreateDetail();
    };
    window.addEventListener(CREATE_MAP_TOOLBAR_CREATE_EVENT, onToolbarCreate);
    return () => window.removeEventListener(CREATE_MAP_TOOLBAR_CREATE_EVENT, onToolbarCreate);
  }, [enterCreateDetail]);

  const createPlan = async (prompt?: string) => {
    if (readOnly || historicalWorkspace) return;
    const request = (prompt ?? description).trim();
    if (!projectId || (!request && !documentId) || busy) return;
    if (request && containsUnsafeDescriptionContent(request)) {
      setError(DIRECT_MAP_UNSAFE_DESCRIPTION_MESSAGE);
      return;
    }
    setDescription(request);
    setOperation('planning');
    setError(null);
    if (request) {
      setChatMessages((current) => [...current, { id: nextMessageId(), role: 'user', text: request }]);
    }
    try {
      const created = await service.createPlanV3(
        request,
        projectId || undefined,
        documentId || undefined,
        {
          references: plan.references.map(({ assetId, role, usage }) => ({ assetId, role, usage })),
          styleReference: plan.styleReference
            ? { assetId: plan.styleReference.assetId, copy: plan.styleReference.copy }
            : null,
        },
      );
      const nextScene = createEmptyMapSceneV3(created.plan);
      draft.reset();
      generation.reset();
      invalidateHistoricalSelection();
      setPlan(created.plan);
      setScene(nextScene);
      await draft.create(projectId, created.sourceToken, created.plan, nextScene);
      await savedMaps.refetch();
      setChatMessages((current) => [
        ...current,
        { id: nextMessageId(), role: 'assistant', text: 'Done - creation check complete' },
        { id: nextMessageId(), role: 'assistant', text: 'Here is the created map plan' },
      ]);
      setViewMode('detail');
      setPlanDetailsOpen(true);
      setLeftOpen(false);
      setRightOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the direct map Plan.');
    } finally {
      setOperation('idle');
    }
  };

  const attachDesignFile = async (file: File) => {
    if (readOnly || historicalWorkspace || busy) return;
    const validation = validateDesignFile(file);
    if (!validation.ok) {
      setError(validation.error ?? 'Unsupported file.');
      return;
    }
    setError(null);
    try {
      const parsed = await parseDocument(file);
      const text = parsed.text.trim();
      if (!text) {
        setError('No text could be extracted from this file.');
        return;
      }
      clearAttachedDocument();
      await createPlan(text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to parse the file.');
    }
  };

  const openSavedMap = useCallback(async (map: SavedMapSummary, refresh = false) => {
    if ((!refresh && map.id === draft.identity?.mapId) || savedMapSwitchBlocked(draft)) return;
    const requestEpoch = ++openRequestEpoch.current;
    invalidateHistoricalSelection();
    setOperation('opening');
    setOpeningMapId(map.id);
    setError(null);
    try {
      const loaded = await service.loadSavedMapV3(map.id);
      const prepared = await generation.prepareRestore(loaded);
      if (!savedMapOpenIsCurrent(openRequestEpoch.current, requestEpoch)) return;
      setProjectId(loaded.projectId);
      setDocumentId(loaded.sourceDocumentId ?? '');
      setDocumentName('');
      setPlan(prepared.plan);
      setScene(prepared.scene);
      draft.install(loaded);
      generation.installRestore(prepared);
      setChatMessages([
        { id: nextMessageId(), role: 'user', text: `Open map: ${loaded.plan.name}` },
        { id: nextMessageId(), role: 'assistant', text: 'Done - creation check complete' },
        { id: nextMessageId(), role: 'assistant', text: 'Here is the created map plan' },
        ...(prepared.scene.mapImage
          ? [{ id: nextMessageId(), role: 'assistant' as const, text: 'Here is the created map' }]
          : []),
      ]);
      setViewMode('detail');
      // Opening a saved map should restore the inspector so the loaded plan,
      // generation state, and collision grid are immediately available. The
      // mobile drawer also needs to be open; otherwise the collision status
      // exists in state but is not rendered for the user.
      setPlanDetailsOpen(true);
      setRightOpen(true);
    } catch (cause) {
      if (savedMapOpenIsCurrent(openRequestEpoch.current, requestEpoch)) {
        setError(cause instanceof Error ? cause.message : 'Could not open the saved map.');
      }
    } finally {
      if (savedMapOpenIsCurrent(openRequestEpoch.current, requestEpoch)) {
        setOperation('idle');
        setOpeningMapId(null);
      }
    }
  }, [draft, generation, invalidateHistoricalSelection, service]);

  const selectMapVersion = async (mapRevisionId: string) => {
    const mapId = draft.identity?.mapId;
    if (!mapId || busy) return;
    if (historicalWorkspace?.mapVersion.mapRevisionId === mapRevisionId) {
      invalidateHistoricalSelection();
      return;
    }
    invalidateHistoricalSelection();
    const requestEpoch = ++historicalSelectionEpoch.current;
    setError(null);
    try {
      const loaded = await service.loadMapVersionV3(mapId, mapRevisionId);
      if (historicalSelectionEpoch.current !== requestEpoch || draft.identity?.mapId !== mapId) return;
      setHistoricalWorkspace(loaded);
      setPlanDetailsOpen(true);
      setRightOpen(true);
    } catch (cause) {
      if (historicalSelectionEpoch.current === requestEpoch) {
        setError(cause instanceof Error ? cause.message : 'Could not open the selected Map version.');
      }
    }
  };

  useEffect(() => {
    if (!agentRefresh || (projectId && agentRefresh.projectId !== projectId)) return;
    pendingRefresh.current = { projectId: agentRefresh.projectId, mapId: agentRefresh.mapId };
    void savedMaps.refetch();
    void mapGenerationHistory.refetch();
    setRefreshVersion((version) => version + 1);
  }, [agentRefresh, projectId, savedMaps.refetch, mapGenerationHistory.refetch]);

  useEffect(() => {
    const refresh = pendingRefresh.current;
    // Wait for autosave before installing durable state, preserving local edits.
    if (!refresh || busy || mapSwitchBlocked) return;
    if (projectId && refresh.projectId !== projectId) {
      pendingRefresh.current = null;
      return;
    }
    const target = savedMaps.maps.find((map) => map.id === (refresh.mapId ?? draft.identity?.mapId));
    if (!target || target.projectId !== refresh.projectId) return;
    pendingRefresh.current = null;
    void openSavedMap(target, true);
  }, [refreshVersion, busy, mapSwitchBlocked, draft, projectId, savedMaps.maps, openSavedMap]);

  useEffect(() => {
    if (!requestedMapId) {
      openedRequestedMapId.current = null;
      return;
    }
    if (savedMaps.isLoading || openedRequestedMapId.current === requestedMapId) return;
    const requestedMap = savedMaps.maps.find((map) => map.id === requestedMapId);
    if (!requestedMap) {
      if (savedMaps.maps.length > 0) {
        openedRequestedMapId.current = requestedMapId;
        setError('The requested saved map could not be found.');
      }
      return;
    }
    openedRequestedMapId.current = requestedMapId;
    void openSavedMap(requestedMap);
  }, [openSavedMap, requestedMapId, savedMaps.isLoading, savedMaps.maps]);

  const uploadReference = async (file: File) => {
    if (readOnly || historicalWorkspace || !projectId || referenceBusy) return;
    setReferenceBusy(true);
    setReferenceError(null);
    try {
      const uploaded = await service.uploadReference(projectId, file);
      setReferences((current) => [uploaded, ...current.filter((entry) => entry.id !== uploaded.id)]);
    } catch (cause) {
      setReferenceError(cause instanceof Error ? cause.message : 'Could not upload the map reference.');
    } finally {
      setReferenceBusy(false);
    }
  };

  const image = useMemo((): DirectMapCanvasImage | null => {
    const binding = scene.mapImage;
    const boundImage = generation.boundImage;
    if (!binding || !boundImage?.signedUrl || binding.sourceRevisionId !== boundImage.sourceRevisionId) return null;
    return {
      sourceRevisionId: boundImage.sourceRevisionId,
      sha256: boundImage.sha256,
      signedUrl: boundImage.signedUrl,
      width: boundImage.width,
      height: boundImage.height,
    };
  }, [generation.boundImage, scene.mapImage]);
  const collision = useDirectMapCollisionGrid({
    projectId,
    identity: draft.identity,
    canAnalyze: !readOnly && !historicalWorkspace && draft.status === 'saved' && !draft.isDirty,
    scene,
    image,
    service,
    setScene,
  });

  const historicalImage = useMemo((): DirectMapCanvasImage | null => {
    const workspaceImage = historicalWorkspace?.image;
    if (!historicalWorkspace || !workspaceImage?.signedUrl || !workspaceImage.sha256
      || !workspaceImage.width || !workspaceImage.height) return null;
    return {
      sourceRevisionId: historicalWorkspace.mapVersion.mapRevisionId,
      sha256: workspaceImage.sha256,
      signedUrl: workspaceImage.signedUrl,
      width: workspaceImage.width,
      height: workspaceImage.height,
    };
  }, [historicalWorkspace]);
  const workspacePlan = historicalWorkspace?.mapPlan ?? plan;
  const workspaceScene = historicalWorkspace?.mapScene ?? scene;
  const workspaceImage = historicalWorkspace ? historicalImage : image;
  const workspaceValidation = useMemo(() => validateMapPlanV3(workspacePlan), [workspacePlan]);
  const workspaceIssues = workspaceValidation.success === false ? workspaceValidation.issues : [];
  const actionError = error ?? draft.error ?? generation.error;
  const mapVersionLabel = historicalWorkspace
    ? `Map V${historicalWorkspace.mapVersion.mapVersionNumber}`
    : mapVersionLabelForRevision(mapGenerationHistory.revisions, workspaceImage?.sourceRevisionId ?? null);
  const generationHistory: MapGenerationHistoryEntry[] = mapGenerationHistory.revisions.map((revision) => ({
    mapRevisionId: revision.mapRevisionId,
    mapVersionNumber: revision.mapVersionNumber,
    planVersionNumber: revision.planVersionNumber,
    isCurrent: revision.mapRevisionId === (historicalWorkspace?.mapVersion.mapRevisionId ?? image?.sourceRevisionId),
  }));
  const showRightPanel = viewMode === 'detail' && planDetailsOpen;

  return (
    <main
      className={`${styles.workbench} ${showRightPanel ? '' : styles.workbenchCanvasOnly} ${leftCollapsed ? styles.workbenchLeftCollapsed : ''}`}
      data-testid="create-map-workbench"
      data-mode="direct"
      data-schema-version="3"
      data-view={viewMode}
    >
      {(leftOpen || rightOpen) ? (
        <button type="button" className={styles.drawerScrim} aria-label="Close side panels" onClick={closeDrawers} />
      ) : null}

      <aside className={`${styles.leftPanel} ${leftOpen ? styles.drawerOpen : ''}`} aria-label="Map source and references">
        <button type="button" className={styles.drawerClose} aria-label="Close source panel" onClick={() => setLeftOpen(false)}>
          <CloseOutlined />
        </button>
        <MapSourcePanel
          projects={sources.projects}
          projectId={projectId}
          onProjectChange={handleProjectChange}
          readOnly={workspaceReadOnly}
          busy={busy}
          error={actionError ?? (sources.error instanceof Error ? sources.error.message : null)}
        />
        {viewMode === 'browse' ? (
          <SavedMapsPanel
            maps={savedMaps.maps}
            isLoading={savedMaps.isLoading}
            error={savedMaps.error instanceof Error ? savedMaps.error.message : null}
            activeMapId={draft.identity?.mapId ?? null}
            openingMapId={openingMapId}
            projectId={projectId || undefined}
            disabled={savedMapSwitchBlocked(draft) || operation === 'planning'}
            onOpen={(map) => void openSavedMap(map)}
            onRetry={() => void savedMaps.refetch()}
            onCreate={enterCreateDetail}
            readOnly={readOnly}
          />
        ) : (
          <MapChatPanel
            mapTitle={workspacePlan.name}
            messages={chatMessages}
            onBack={() => {
              invalidateHistoricalSelection();
              setViewMode('browse');
              setPlanDetailsOpen(false);
            }}
            onCreate={enterCreateDetail}
            onAsk={(prompt) => void createPlan(prompt)}
            canAsk={Boolean(projectId) && !workspaceReadOnly}
            busy={busy}
            readOnly={workspaceReadOnly}
            error={actionError}
            attachedDocument={documentId ? { id: documentId, name: documentName || 'Keco Document' } : null}
            onClearAttachedDocument={clearAttachedDocument}
            onAttachFile={(file) => void attachDesignFile(file)}
            onAttachKecoDocument={() => {
              if (!projectId || workspaceReadOnly || busy) return;
              setDocumentPickerOpen(true);
            }}
            generationHistory={generationHistory}
            onSelectMapVersion={selectMapVersion}
            mapPlan={draft.identity ? {
              title: workspacePlan.name,
              versionLabel: historicalWorkspace
                ? `Plan V${historicalWorkspace.mapVersion.planVersionNumber}`
                : hasCurrentSavedPlan && savedPlanSelection ? `Plan V${savedPlanSelection.versionNumber}` : 'Draft',
            } : null}
            mapImage={workspaceImage ? {
              title: workspacePlan.name,
              versionLabel: mapVersionLabel ?? 'Current map',
              downloadUrl: workspaceImage.signedUrl,
            } : null}
            onViewMapPlan={() => {
              setPlanDetailsOpen(true);
              setRightOpen(true);
            }}
          />
        )}
      </aside>

      {documentPickerOpen ? (
        <SelectDocumentModal
          open={documentPickerOpen}
          projectId={projectId}
          selectedDocumentId={documentId || null}
          onClose={() => setDocumentPickerOpen(false)}
          onSelect={(document) => {
            setDocumentId(document.id);
            setDocumentName(document.name);
            setError(null);
          }}
        />
      ) : null}

      <section className={styles.directCanvasPanel} aria-label="Map canvas">
        {mapVersionLabel ? (
          <div className={styles.mapVersionIndicator}>
            {mapVersionLabel}
          </div>
        ) : null}
        <DirectMapCanvas
          plan={workspacePlan}
          scene={workspaceScene}
          image={workspaceImage}
          collisionGrid={workspaceScene.collisionGrid}
          collisionVisible={collision.overlayVisible}
          paintMode={collision.paintMode}
          onPaintCell={workspaceReadOnly ? undefined : collision.paintCell}
        />
      </section>

      {showRightPanel ? (
        <aside className={`${styles.rightPanel} ${rightOpen ? styles.drawerOpen : ''}`} aria-label="Map plan and generation">
          <button
            type="button"
            className={styles.drawerClose}
            aria-label="Close inspector panel"
            onClick={() => setRightOpen(false)}
          >
            <CloseOutlined />
          </button>
          <DirectMapPlanInspector
            plan={workspacePlan}
            issues={workspaceIssues}
            onChange={changePlan}
            onSavePlan={() => void savePlan()}
            disabled={busy || workspaceReadOnly}
            onClose={() => {
              setPlanDetailsOpen(false);
              setRightOpen(false);
            }}
            versionLabel={historicalWorkspace
              ? `Plan V${historicalWorkspace.mapVersion.planVersionNumber}`
              : hasCurrentSavedPlan && savedPlanSelection ? `Plan V${savedPlanSelection.versionNumber}` : 'Draft'}
          />
          <DirectMapGenerationPanel
            key={historicalWorkspace?.mapVersion.mapRevisionId ?? 'draft'}
            phase={generation.phase}
            asset={generation.asset}
            error={generation.error}
            canGenerate={canGenerate}
            canRetry={generation.canRetry}
            canResolveUnknown={generation.canResolveUnknown}
            onGenerate={() => void generation.generate()}
            onRetry={() => void generation.retry()}
            onResolveUnknown={(acknowledged) => void generation.resolveUnknownAndRestart(acknowledged)}
            readOnly={workspaceReadOnly}
          />
          {workspaceImage ? (
            <DirectMapCollisionPanel
              grid={workspaceScene.collisionGrid}
              phase={collision.phase}
              error={collision.error}
              overlayVisible={collision.overlayVisible}
              paintMode={collision.paintMode}
              onOverlayVisibleChange={collision.setOverlayVisible}
              onPaintModeChange={collision.setPaintMode}
              onRetry={() => void collision.retry()}
              onClear={collision.clearGrid}
              readOnly={workspaceReadOnly}
            />
          ) : null}
          <MapReferencePanel
            projectId={projectId}
            records={references}
            references={workspacePlan.references}
            styleReference={workspacePlan.styleReference}
            busy={busy || referenceBusy || workspaceReadOnly}
            error={referenceError}
            onReferencesChange={(next) => changePlan({ ...plan, references: next })}
            onStyleReferenceChange={(next) => changePlan({ ...plan, styleReference: next })}
            onUpload={(file) => void uploadReference(file)}
          />
        </aside>
      ) : null}
    </main>
  );
}
