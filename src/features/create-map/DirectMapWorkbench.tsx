'use client';

import { CloseOutlined, MenuFoldOutlined, SettingOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';
import { DirectMapCanvas, type DirectMapCanvasImage } from './components/DirectMapCanvas';
import { DirectMapGenerationPanel } from './components/DirectMapGenerationPanel';
import { DirectMapPlanInspector } from './components/DirectMapPlanInspector';
import { MapReferencePanel } from './components/MapReferencePanel';
import { MapSourcePanel } from './components/MapSourcePanel';
import { SavedMapsPanel } from './components/SavedMapsPanel';
import {
  createMapDraftAdapterV3,
  useMapDraft,
} from './hooks/useMapDraft';
import { useDirectMapGeneration } from './hooks/useDirectMapGeneration';
import { useMapSources } from './hooks/useMapSources';
import { savedMapOpenIsCurrent, savedMapSwitchBlocked, useSavedMaps } from './hooks/useSavedMaps';
import {
  createEmptyMapSceneV3,
  validateMapPlanV3,
  type MapPlanV3,
  type MapSceneV3,
} from './model/directMapSchema';
import {
  createMapService,
  type MapReferenceRecord,
  type MapSourceToken,
  type SavedMapSummary,
} from './services/createMapService';
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

export type DirectMapWorkbenchProps = {
  onOpenLegacyMap: (mapId: string) => void;
};

export function DirectMapWorkbench({ onOpenLegacyMap }: DirectMapWorkbenchProps) {
  const supabase = useSupabase();
  const service = useMemo(() => createMapService(supabase), [supabase]);
  const adapter = useMemo(() => createMapDraftAdapterV3(service), [service]);
  const [plan, setPlan] = useState(INITIAL_DIRECT_PLAN);
  const [scene, setScene] = useState<MapSceneV3>(() => createEmptyMapSceneV3(INITIAL_DIRECT_PLAN));
  const [description, setDescription] = useState('A compact top-down village map with a market square, clear paths, and natural boundaries.');
  const [projectId, setProjectId] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [sourceToken, setSourceToken] = useState<MapSourceToken | null>(null);
  const [references, setReferences] = useState<MapReferenceRecord[]>([]);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [operation, setOperation] = useState<'idle' | 'planning' | 'opening'>('idle');
  const [openingMapId, setOpeningMapId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const openRequestEpoch = useRef(0);
  const referenceRequestEpoch = useRef(0);

  const sources = useMapSources(projectId);
  const savedMaps = useSavedMaps();
  const draft = useMapDraft(plan, scene, adapter);
  const generation = useDirectMapGeneration({
    projectId,
    plan,
    scene,
    canPrepare: Boolean(draft.identity) && draft.status === 'saved' && !draft.isDirty && draft.isValid,
    publishForGeneration: draft.publishForGeneration,
    onSceneMaterialized: setScene,
  });
  const validation = useMemo(() => validateMapPlanV3(plan), [plan]);
  const issues = validation.success === false ? validation.issues : [];
  const busy = operation !== 'idle' || draft.status === 'creating' || draft.status === 'saving'
    || generation.phase === 'preparing' || generation.phase === 'submitting';
  const canSave = Boolean(projectId) && validation.success && draft.isValid
    && (!draft.identity || draft.isDirty) && !busy;
  const canGenerate = Boolean(draft.identity) && validation.success && draft.isValid
    && !draft.isDirty && draft.status === 'saved' && !busy;

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
    setSourceToken(null);
    setPlan((current) => ({ ...current, references: [], styleReference: null }));
    draft.reset();
    generation.reset();
    setOpeningMapId(null);
    setError(null);
  };

  const createPlan = async () => {
    const request = description.trim();
    if (!request || busy) return;
    setOperation('planning');
    setError(null);
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
      setPlan(created.plan);
      setScene(createEmptyMapSceneV3(created.plan));
      setSourceToken(created.sourceToken);
      draft.reset();
      generation.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the direct map Plan.');
    } finally {
      setOperation('idle');
    }
  };

  const saveDraft = async () => {
    if (!canSave) return;
    setError(null);
    try {
      if (draft.identity) await draft.saveNow();
      else {
        await draft.create(projectId, sourceToken, plan, scene);
        await savedMaps.refetch();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the direct map draft.');
    }
  };

  const openSavedMap = async (map: SavedMapSummary) => {
    if (map.schemaVersion === 2) {
      onOpenLegacyMap(map.id);
      return;
    }
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
      setSourceToken(null);
      setPlan(prepared.plan);
      setScene(prepared.scene);
      draft.install(loaded);
      generation.installRestore(prepared);
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
  };

  const uploadReference = async (file: File) => {
    if (!projectId || referenceBusy) return;
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

  return (
    <main className={styles.workbench} data-testid="create-map-workbench" data-mode="direct" data-schema-version="3">
      {(leftOpen || rightOpen) ? (
        <button type="button" className={styles.drawerScrim} aria-label="Close side panels" onClick={closeDrawers} />
      ) : null}

      <aside className={`${styles.leftPanel} ${leftOpen ? styles.drawerOpen : ''}`} aria-label="Map source and references">
        <button type="button" className={styles.drawerClose} aria-label="Close source panel" onClick={() => setLeftOpen(false)}>
          <CloseOutlined />
        </button>
        <MapSourcePanel
          versionLabel="V3"
          projects={sources.projects}
          documents={sources.documents}
          description={description}
          projectId={projectId}
          documentId={documentId}
          onDescriptionChange={setDescription}
          onProjectChange={handleProjectChange}
          onDocumentChange={setDocumentId}
          onCreatePlan={() => void createPlan()}
          onSaveDraft={() => void saveDraft()}
          onGenerate={() => void generation.prepare()}
          canSave={canSave}
          canGenerate={canGenerate && (generation.phase === 'idle' || generation.phase === 'failed' || generation.phase === 'ready')}
          busy={busy}
          error={actionError ?? (sources.error instanceof Error ? sources.error.message : null)}
        />
        <SavedMapsPanel
          maps={savedMaps.maps}
          isLoading={savedMaps.isLoading}
          error={savedMaps.error instanceof Error ? savedMaps.error.message : null}
          activeMapId={draft.identity?.mapId ?? null}
          openingMapId={openingMapId}
          disabled={savedMapSwitchBlocked(draft) || operation === 'planning'}
          onOpen={(map) => void openSavedMap(map)}
          onRetry={() => void savedMaps.refetch()}
        />
        <MapReferencePanel
          projectId={projectId}
          records={references}
          references={plan.references}
          styleReference={plan.styleReference}
          busy={busy || referenceBusy}
          error={referenceError}
          onReferencesChange={(next) => changePlan({ ...plan, references: next })}
          onStyleReferenceChange={(next) => changePlan({ ...plan, styleReference: next })}
          onUpload={(file) => void uploadReference(file)}
        />
      </aside>

      <section className={styles.directCanvasPanel} aria-label="Map canvas">
        <header className={styles.canvasHeader}>
          <div>
            <span className={styles.eyebrow}>Direct image</span>
            <h2>{plan.name}</h2>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={`${styles.miniIconButton} ${styles.mobileOnly}`} aria-label="Open source panel" onClick={() => setLeftOpen(true)}>
              <MenuFoldOutlined />
            </button>
            <div className={styles.saveIndicator} data-status={saveStatus.status}><span aria-hidden />{saveStatus.label}</div>
            <button type="button" className={`${styles.miniIconButton} ${styles.mobileOnly}`} aria-label="Open inspector panel" onClick={() => setRightOpen(true)}>
              <SettingOutlined />
            </button>
          </div>
        </header>
        <DirectMapCanvas plan={plan} scene={scene} image={image} />
      </section>

      <aside className={`${styles.rightPanel} ${rightOpen ? styles.drawerOpen : ''}`} aria-label="Map plan and generation">
        <button type="button" className={styles.drawerClose} aria-label="Close inspector panel" onClick={() => setRightOpen(false)}>
          <CloseOutlined />
        </button>
        <DirectMapPlanInspector plan={plan} issues={issues} onChange={changePlan} disabled={busy} />
        <DirectMapGenerationPanel
          phase={generation.phase}
          asset={generation.asset}
          error={generation.error}
          canPrepare={canGenerate}
          canRetry={generation.canRetry}
          canResolveUnknown={generation.canResolveUnknown}
          onPrepare={() => void generation.prepare()}
          onConfirm={() => void generation.confirm()}
          onRetry={() => void generation.retry()}
          onRegenerate={() => void generation.regenerate()}
          onResolveUnknown={(acknowledged) => void generation.resolveUnknownAndRestart(acknowledged)}
        />
      </aside>
    </main>
  );
}
