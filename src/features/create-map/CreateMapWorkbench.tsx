'use client';

import { CloseOutlined } from '@ant-design/icons';
import { useCallback, useMemo, useState } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';
import { AssetGenerationPanel } from './components/AssetGenerationPanel';
import { MapPlanInspector } from './components/MapPlanInspector';
import { PlanReviewCanvas, type MapPlanSelection } from './components/PlanReviewCanvas';
import { MapSourcePanel } from './components/MapSourcePanel';
import { MapToolbar, type MapTool } from './components/MapToolbar';
import { useMapSources } from './hooks/useMapSources';
import { useMapDraft } from './hooks/useMapDraft';
import { useMapGeneration } from './hooks/useMapGeneration';
import {
  createMapPlanEditorState,
  reduceMapPlanCommand,
  redoMapPlan,
  undoMapPlan,
  type MapPlanCommand,
} from './model/mapPlanReducer';
import { validateMapPlanV2, type MapPlanV2 } from './model/mapPlanSchema';
import type { MapSceneV2 } from './model/mapSceneSchema';
import { createMapService, type MapSourceToken } from './services/createMapService';
import styles from './CreateMapWorkbench.module.css';

export type CreateMapWorkbenchMode = 'plan-review' | 'scene';

export type PlanReviewActionState = {
  projectId: string;
  hasIdentity: boolean;
  valid: boolean;
  dirty: boolean;
  busy: boolean;
};

export function getPlanReviewActions(state: PlanReviewActionState): {
  canSave: boolean;
  canGenerate: boolean;
} {
  return {
    canSave: Boolean(state.projectId) && state.valid && (!state.hasIdentity || state.dirty) && !state.busy,
    canGenerate: state.hasIdentity && state.valid && !state.dirty && !state.busy,
  };
}

const INITIAL_PLAN_V2: MapPlanV2 = {
  schemaVersion: 2,
  name: 'Untitled layered map',
  visualBrief: 'A readable top-down village clearing with an earth road and editable natural obstacles.',
  map: { width: 640, height: 448, tileSize: 32, projection: 'top-down' },
  background: {
    stylePrompt: 'Top-down pixel art with clear paths, quiet natural color, and crisp silhouettes.',
    palette: ['#7f9c68', '#b59a6c', '#4f6f57'],
    baseTerrainKey: 'meadow-grass',
    regions: [
      {
        id: 'earth-clearing',
        terrainKey: 'packed-earth',
        points: [
          { x: 64, y: 128 },
          { x: 352, y: 96 },
          { x: 384, y: 352 },
          { x: 96, y: 384 },
        ],
      },
    ],
    paths: [
      {
        id: 'village-road',
        name: 'Village road',
        prompt: 'Earth road path tiles for meadow terrain.',
        kind: 'road',
        assetKey: 'village-road-tiles',
        terrainKey: 'packed-earth',
        width: 32,
        zIndex: 1,
        points: [{ x: 0, y: 224 }, { x: 640, y: 224 }],
      },
    ],
  },
  terrains: [
    { assetKey: 'meadow-grass', name: 'Meadow grass', prompt: 'Seamless meadow grass terrain.' },
    { assetKey: 'packed-earth', name: 'Packed earth', prompt: 'Seamless packed earth terrain.' },
  ],
  obstacleAssets: [
    {
      assetKey: 'oak-tree',
      name: 'Oak tree',
      prompt: 'Transparent top-down oak tree.',
      size: { width: 64, height: 80 },
      groundAnchor: { x: 32, y: 72 },
    },
  ],
  obstaclePlacements: [
    {
      id: 'tree-1',
      assetKey: 'oak-tree',
      position: { x: 448, y: 160 },
      scale: 1,
      rotation: 0,
      zIndex: 10,
      collision: { shape: 'circle', cx: 0, cy: -10, radius: 20 },
    },
  ],
};

function createEmptySceneV2(plan: MapPlanV2): MapSceneV2 {
  return {
    schemaVersion: 2,
    size: { width: plan.map.width, height: plan.map.height, tileSize: plan.map.tileSize },
    background: null,
    layers: [
      { id: 'background', name: 'Background', kind: 'background', visible: true, locked: true },
      { id: 'obstacles', name: 'Obstacles', kind: 'obstacles', visible: true, locked: false },
      { id: 'collision', name: 'Collision', kind: 'collision', visible: false, locked: false },
    ],
    obstacleEntities: [],
    canvas: { zoom: 1, panX: 24, panY: 24, snapToGrid: true },
  };
}

type PlanStructureProps = {
  plan: MapPlanV2;
  selection: MapPlanSelection;
  onSelectionChange: (selection: MapPlanSelection) => void;
};

function PlanStructure({ plan, selection, onSelectionChange }: PlanStructureProps) {
  const entries = [
    ...plan.background.regions.map((region) => ({
      id: region.id,
      kind: 'region' as const,
      label: region.id,
      detail: region.terrainKey,
    })),
    ...plan.background.paths.map((path) => ({
      id: path.id,
      kind: 'path' as const,
      label: path.name,
      detail: path.kind,
    })),
    ...plan.obstaclePlacements.map((placement) => ({
      id: placement.id,
      kind: 'placement' as const,
      label: placement.id,
      detail: placement.assetKey,
    })),
  ];

  return (
    <section className={`${styles.panelSection} ${styles.layerSection}`} aria-labelledby="map-structure-heading">
      <div className={styles.sectionHeadingRow}>
        <h2 id="map-structure-heading" className={styles.sectionTitleSmall}>Plan structure</h2>
        <span className={styles.itemMeta}>{entries.length} items</span>
      </div>
      <ul className={styles.contentList} aria-label="Map plan structure">
        {entries.map((entry) => {
          const selected = selection?.kind === entry.kind && selection.id === entry.id;
          return (
            <li key={`${entry.kind}-${entry.id}`} className={selected ? styles.contentItemSelected : styles.contentItem}>
              <button
                type="button"
                className={styles.itemName}
                aria-pressed={selected}
                onClick={() => onSelectionChange({ kind: entry.kind, id: entry.id })}
              >
                <span className={styles.layerSwatch} data-kind={entry.kind} aria-hidden />
                <span>{entry.label}</span>
              </button>
              <span className={styles.itemMeta}>{entry.detail}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function CreateMapWorkbench() {
  const supabase = useSupabase();
  const service = useMemo(() => createMapService(supabase), [supabase]);
  const [mode] = useState<CreateMapWorkbenchMode>('plan-review');
  const [planReview, setPlanReview] = useState(() => createMapPlanEditorState(INITIAL_PLAN_V2));
  const [selection, setSelection] = useState<MapPlanSelection>(null);
  const [description, setDescription] = useState(
    'A compact top-down village market with grass, an earth road, and movable trees.'
  );
  const [projectId, setProjectId] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [sourceToken, setSourceToken] = useState<MapSourceToken | null>(null);
  const [scene, setScene] = useState(() => createEmptySceneV2(INITIAL_PLAN_V2));
  const [operation, setOperation] = useState<'idle' | 'planning'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<MapTool>('select');
  const [viewport, setViewport] = useState({ zoom: 1, panX: 24, panY: 24 });
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  const sources = useMapSources(projectId);
  const draft = useMapDraft(planReview.present, scene);
  const installMaterializedScene = useCallback((nextScene: MapSceneV2) => setScene(nextScene), []);
  const generation = useMapGeneration({
    projectId,
    plan: planReview.present,
    scene,
    canPrepare: Boolean(draft.identity) && draft.status === 'saved' && !draft.isDirty,
    publishForGeneration: draft.publishForGeneration,
    onSceneMaterialized: installMaterializedScene,
  });
  const validation = useMemo(() => validateMapPlanV2(planReview.present), [planReview.present]);
  const issues = validation.success === false ? validation.issues : [];
  const dirty = draft.isDirty;
  const busy = operation !== 'idle' || draft.status === 'creating' || generation.phase === 'preparing';
  const { canSave, canGenerate } = getPlanReviewActions({
    projectId,
    hasIdentity: draft.identity !== null,
    valid: validation.success && draft.isValid,
    dirty,
    busy,
  });
  const canPrepareGeneration = canGenerate && (generation.phase === 'idle' || generation.phase === 'failed');

  const dispatchPlan = (command: MapPlanCommand) => {
    setPlanReview((current) => reduceMapPlanCommand(current, command));
  };

  const handleProjectChange = (nextProjectId: string) => {
    if (nextProjectId === projectId) return;
    setProjectId(nextProjectId);
    setDocumentId('');
    setSourceToken(null);
    draft.reset();
    generation.reset();
    setError(null);
  };

  const createPlan = async () => {
    const requestDescription = description.trim();
    if (!requestDescription || busy) return;
    setOperation('planning');
    setError(null);
    try {
      const created = await service.createPlanV2(
        requestDescription,
        projectId || undefined,
        documentId || undefined
      );
      setPlanReview(createMapPlanEditorState(created.plan));
      setSelection(null);
      setSourceToken(created.sourceToken);
      const nextScene = createEmptySceneV2(created.plan);
      setScene(nextScene);
      draft.reset();
      generation.reset();
      setTool('select');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create map plan');
    } finally {
      setOperation('idle');
    }
  };

  const saveDraft = async () => {
    if (!canSave) return;
    setError(null);
    try {
      if (draft.identity) {
        await draft.saveNow();
      } else {
        await draft.create(projectId, sourceToken, planReview.present, scene);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save map draft');
    }
  };

  const requestGeneration = () => {
    if (!canPrepareGeneration) return;
    void generation.prepare();
  };

  const actionError = error ?? draft.error ?? generation.error;
  const saveStatus = draft.status === 'saving' || draft.status === 'creating'
    ? { label: 'Saving...', status: 'saving' }
    : draft.status === 'conflict'
      ? { label: 'Save conflict', status: 'error' }
      : actionError
      ? { label: 'Action failed', status: 'error' }
      : draft.identity && dirty
        ? { label: 'Unsaved changes', status: 'dirty' }
        : draft.identity
          ? { label: 'All changes saved', status: 'saved' }
          : { label: projectId ? 'Local plan, ready to save' : 'Local plan', status: 'local' };

  const closeDrawers = () => {
    setLeftOpen(false);
    setRightOpen(false);
  };

  return (
    <main className={styles.workbench} data-testid="create-map-workbench" data-mode={mode}>
      {(leftOpen || rightOpen) ? (
        <button type="button" className={styles.drawerScrim} aria-label="Close side panels" onClick={closeDrawers} />
      ) : null}

      <aside className={`${styles.leftPanel} ${leftOpen ? styles.drawerOpen : ''}`} aria-label="Map source and structure">
        <button
          type="button"
          className={styles.drawerClose}
          aria-label="Close source panel"
          onClick={() => setLeftOpen(false)}
        >
          <CloseOutlined />
        </button>
        <MapSourcePanel
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
          onGenerate={requestGeneration}
          canSave={canSave}
          canGenerate={canPrepareGeneration}
          busy={busy}
          error={actionError ?? (sources.error instanceof Error ? sources.error.message : null)}
        />
        <PlanStructure plan={planReview.present} selection={selection} onSelectionChange={setSelection} />
      </aside>

      <section className={styles.canvasPanel} aria-label="Map canvas">
        <header className={styles.canvasHeader}>
          <div>
            <span className={styles.eyebrow}>Plan Review</span>
            <h2>{planReview.present.name}</h2>
          </div>
          <div className={styles.saveIndicator} data-status={saveStatus.status}>
            <span aria-hidden />
            {saveStatus.label}
          </div>
        </header>
        <MapToolbar
          mode={mode}
          tool={tool}
          zoom={viewport.zoom}
          canUndo={planReview.past.length > 0}
          canRedo={planReview.future.length > 0}
          snapToGrid={snapToGrid}
          onToolChange={setTool}
          onUndo={() => setPlanReview((current) => undoMapPlan(current))}
          onRedo={() => setPlanReview((current) => redoMapPlan(current))}
          onZoomChange={(zoom) => setViewport((current) => ({ ...current, zoom }))}
          onSnapChange={setSnapToGrid}
          onToggleLeft={() => setLeftOpen((open) => !open)}
          onToggleRight={() => setRightOpen((open) => !open)}
        />
        <PlanReviewCanvas
          plan={planReview.present}
          selection={selection}
          issues={issues}
          viewport={viewport}
          onCommand={dispatchPlan}
          onSelectionChange={setSelection}
        />
      </section>

      <aside className={`${styles.rightPanel} ${rightOpen ? styles.drawerOpen : ''}`} aria-label="Map plan and inspector">
        <button
          type="button"
          className={styles.drawerClose}
          aria-label="Close inspector panel"
          onClick={() => setRightOpen(false)}
        >
          <CloseOutlined />
        </button>
        <MapPlanInspector
          plan={planReview.present}
          selection={selection}
          issues={issues}
          onCommand={dispatchPlan}
        />
        <AssetGenerationPanel
          assets={generation.assets}
          phase={generation.phase}
          error={generation.error}
          readyCount={generation.readyCount}
          failedCount={generation.failedCount}
          canPrepare={canPrepareGeneration}
          onPrepare={() => void generation.prepare()}
          onConfirm={() => void generation.confirm()}
          onRetry={(assetId) => void generation.retry(assetId)}
        />
      </aside>
    </main>
  );
}
