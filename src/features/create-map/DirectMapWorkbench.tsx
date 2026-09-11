'use client';

import { CloseOutlined, MenuFoldOutlined, SettingOutlined } from '@ant-design/icons';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SelectDocumentModal } from '@/components/script-system/SelectDocumentModal';
import { parseDocument, validateDesignFile } from '@/lib/document-parser';
import { useSupabase } from '@/lib/SupabaseContext';
import { DirectMapCanvas, type DirectMapCanvasImage } from './components/DirectMapCanvas';
import { DirectMapGenerationPanel } from './components/DirectMapGenerationPanel';
import { DirectMapCollisionPanel } from './components/DirectMapCollisionPanel';
import { DirectMapPlanInspector } from './components/DirectMapPlanInspector';
import { MapChatPanel, type MapChatMessage } from './components/MapChatPanel';
import { MapReferencePanel } from './components/MapReferencePanel';
import { MapSourcePanel } from './components/MapSourcePanel';
import { SavedMapsPanel } from './components/SavedMapsPanel';
import {
  createMapDraftAdapterV3,
  useMapDraft,
} from './hooks/useMapDraft';
import { useDirectMapGeneration } from './hooks/useDirectMapGeneration';
import { useDirectMapCollisionGrid } from './hooks/useDirectMapCollisionGrid';
import { useMapSources } from './hooks/useMapSources';
import { savedMapOpenIsCurrent, savedMapSwitchBlocked, useSavedMaps } from './hooks/useSavedMaps';
import {
  containsUnsafeDescriptionContent,
  DIRECT_MAP_UNSAFE_DESCRIPTION_MESSAGE,
  createEmptyMapSceneV3,
  validateMapPlanV3,
  type MapPlanV3,
  type MapSceneV3,
} from './model/directMapSchema';
import {
  createMapService,
  type MapReferenceRecord,
  type SavedMapSummary,
} from './services/createMapService';
import { readCreateMapProjectPreference, CREATE_MAP_TOOLBAR_CREATE_EVENT } from '@/lib/create-map/projectPreference';
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
  const [rightOpen, setRightOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'browse' | 'detail'>('browse');
  const [chatMessages, setChatMessages] = useState<MapChatMessage[]>([]);
  const [planDetailsOpen, setPlanDetailsOpen] = useState(true);
  const openRequestEpoch = useRef(0);
  const referenceRequestEpoch = useRef(0);
  const openedRequestedMapId = useRef<string | null>(null);
  const previousGenerationPhase = useRef<string>('idle');

  const sources = useMapSources(projectId);
  const savedMaps = useSavedMaps();
  const draft = useMapDraft(plan, scene, adapter);
  const generation = useDirectMapGeneration({
    projectId,
    plan,
    scene,
    canPrepare: Boolean(draft.identity) && draft.status === 'saved' && !draft.isDirty && draft.isValid,
    draftIdentity: draft.identity,
    reloadDraftAfterPreparation: draft.reload,
    onSceneMaterialized: setScene,
  });
  const validation = useMemo(() => validateMapPlanV3(plan), [plan]);
  const issues = validation.success === false ? validation.issues : [];
  const busy = operation !== 'idle' || draft.status === 'creating' || draft.status === 'saving'
    || generation.phase === 'preparing' || generation.phase === 'submitting';
  const canGenerate = !readOnly && Boolean(draft.identity) && validation.success && draft.isValid
    && !draft.isDirty && draft.status === 'saved' && !busy;

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
      setChatMessages((current) => {
        if (current.some((message) => message.text.includes('Here is the created map') && !message.text.includes('plan'))) {
          return current;
        }
        return [...current, { id: nextMessageId(), role: 'assistant', text: 'Here is the created map' }];
      });
    }
    previousGenerationPhase.current = generation.phase;
  }, [generation.phase]);

  const closeDrawers = useCallback(() => {
    setLeftOpen(false);
    setRightOpen(false);
  }, []);

  const changePlan = useCallback((nextPlan: MapPlanV3) => {
    if (scene.size.width !== nextPlan.map.width || scene.size.height !== nextPlan.map.height) {
      setScene(createEmptyMapSceneV3(nextPlan));
      generation.reset();
    }
    setPlan(nextPlan);
  }, [generation, scene.size.height, scene.size.width]);

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
    setViewMode('browse');
  };

  const clearAttachedDocument = useCallback(() => {
    setDocumentId('');
    setDocumentName('');
  }, []);

  const enterCreateDetail = useCallback(() => {
    if (readOnly) return;
    draft.reset();
    generation.reset();
    setPlan(INITIAL_DIRECT_PLAN);
    setScene(createEmptyMapSceneV3(INITIAL_DIRECT_PLAN));
    setDescription('');
    clearAttachedDocument();
    setChatMessages([]);
    setError(null);
    setViewMode('detail');
    setPlanDetailsOpen(true);
    setRightOpen(true);
  }, [clearAttachedDocument, draft, generation, readOnly]);

  useEffect(() => {
    const onToolbarCreate = () => {
      enterCreateDetail();
    };
    window.addEventListener(CREATE_MAP_TOOLBAR_CREATE_EVENT, onToolbarCreate);
    return () => window.removeEventListener(CREATE_MAP_TOOLBAR_CREATE_EVENT, onToolbarCreate);
  }, [enterCreateDetail]);

  const createPlan = async (prompt?: string) => {
    if (readOnly) return;
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
      setPlan(created.plan);
      setScene(nextScene);
      await draft.create(projectId, created.sourceToken, created.plan, nextScene);
      await savedMaps.refetch();
      setChatMessages((current) => [
        ...current,
        { id: nextMessageId(), role: 'assistant', text: 'Done — creation check complete' },
        { id: nextMessageId(), role: 'assistant', text: 'Here is the created map plan' },
      ]);
      setViewMode('detail');
      setPlanDetailsOpen(true);
      setRightOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the direct map Plan.');
    } finally {
      setOperation('idle');
    }
  };

  const attachDesignFile = async (file: File) => {
    if (readOnly || busy) return;
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

  const openSavedMap = useCallback(async (map: SavedMapSummary) => {
    if (map.id === draft.identity?.mapId || savedMapSwitchBlocked(draft)) return;
    const requestEpoch = ++openRequestEpoch.current;
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
        { id: nextMessageId(), role: 'assistant', text: 'Done — creation check complete' },
        { id: nextMessageId(), role: 'assistant', text: 'Here is the created map plan' },
        ...(prepared.scene.mapImage
          ? [{ id: nextMessageId(), role: 'assistant' as const, text: 'Here is the created map' }]
          : []),
      ]);
      setViewMode('detail');
      setPlanDetailsOpen(true);
      closeDrawers();
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
  }, [closeDrawers, draft, generation, service]);

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
    if (readOnly || !projectId || referenceBusy) return;
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
    canAnalyze: !readOnly && draft.status === 'saved' && !draft.isDirty,
    scene,
    image,
    service,
    setScene,
  });

  const actionError = error ?? draft.error ?? generation.error;
  const saveStatus = draft.status === 'saving' || draft.status === 'creating'
    ? { label: 'Saving...', status: 'saving' }
    : draft.status === 'conflict'
      ? { label: 'Save conflict', status: 'error' }
      : actionError
        ? { label: 'Action failed', status: 'error' }
        : draft.identity && draft.isDirty
          ? { label: 'Unsaved changes', status: 'dirty' }
          : draft.identity
            ? { label: 'All changes saved', status: 'saved' }
            : { label: projectId ? 'Local plan, ready to save' : 'Local plan', status: 'local' };

  const showGenerateInChat = Boolean(draft.identity) && ['idle', 'awaiting-confirmation', 'failed', 'ready'].includes(generation.phase);
  const showRightPanel = viewMode === 'detail' && planDetailsOpen;

  return (
    <main
      className={`${styles.workbench} ${showRightPanel ? '' : styles.workbenchBrowse}`}
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
          readOnly={readOnly}
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
            mapTitle={plan.name}
            messages={chatMessages}
            onBack={() => {
              setViewMode('browse');
              setPlanDetailsOpen(false);
            }}
            onCreate={enterCreateDetail}
            onAsk={(prompt) => void createPlan(prompt)}
            onGenerate={() => void generation.generate()}
            canAsk={Boolean(projectId) && !readOnly}
            canGenerate={canGenerate}
            showGenerate={showGenerateInChat}
            busy={busy}
            readOnly={readOnly}
            error={actionError}
            attachedDocument={documentId ? { id: documentId, name: documentName || 'Keco Document' } : null}
            onClearAttachedDocument={clearAttachedDocument}
            onAttachFile={(file) => void attachDesignFile(file)}
            onAttachKecoDocument={() => {
              if (!projectId || readOnly || busy) return;
              setDocumentPickerOpen(true);
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
        <header className={styles.canvasHeader}>
          <div className={styles.headerActions}>
            <button type="button" className={`${styles.miniIconButton} ${styles.mobileOnly}`} aria-label="Open source panel" onClick={() => setLeftOpen(true)}>
              <MenuFoldOutlined />
            </button>
            <div className={styles.saveIndicator} data-status={saveStatus.status}><span aria-hidden />{saveStatus.label}</div>
            {viewMode === 'detail' ? (
              <button
                type="button"
                className={styles.miniIconButton}
                aria-label="Open inspector panel"
                onClick={() => {
                  setPlanDetailsOpen(true);
                  setRightOpen(true);
                }}
              >
                <SettingOutlined />
              </button>
            ) : null}
          </div>
        </header>
        <DirectMapCanvas
          plan={plan}
          scene={scene}
          image={image}
          collisionGrid={scene.collisionGrid}
          collisionVisible={collision.overlayVisible}
          paintMode={collision.paintMode}
          onPaintCell={readOnly ? undefined : collision.paintCell}
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
            plan={plan}
            issues={issues}
            onChange={changePlan}
            disabled={busy || readOnly}
            onClose={() => {
              setPlanDetailsOpen(false);
              setRightOpen(false);
            }}
          />
          <DirectMapGenerationPanel
            phase={generation.phase}
            asset={generation.asset}
            error={generation.error}
            canGenerate={canGenerate}
            canRetry={generation.canRetry}
            canResolveUnknown={generation.canResolveUnknown}
            onGenerate={() => void generation.generate()}
            onRetry={() => void generation.retry()}
            onResolveUnknown={(acknowledged) => void generation.resolveUnknownAndRestart(acknowledged)}
            readOnly={readOnly}
          />
          {image ? (
            <DirectMapCollisionPanel
              grid={scene.collisionGrid}
              phase={collision.phase}
              error={collision.error}
              overlayVisible={collision.overlayVisible}
              paintMode={collision.paintMode}
              onOverlayVisibleChange={collision.setOverlayVisible}
              onPaintModeChange={collision.setPaintMode}
              onRetry={() => void collision.retry()}
              onClear={collision.clearGrid}
              readOnly={readOnly}
            />
          ) : null}
          <MapReferencePanel
            projectId={projectId}
            records={references}
            references={plan.references}
            styleReference={plan.styleReference}
            busy={busy || referenceBusy || readOnly}
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
