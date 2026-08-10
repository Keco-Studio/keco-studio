'use client';

import { CloseOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';
import { AssetGenerationPanel } from './components/AssetGenerationPanel';
import { MapCanvas, type MapRenderAsset } from './components/MapCanvas';
import { MapLayerList } from './components/MapLayerList';
import { MapPlanInspector } from './components/MapPlanInspector';
import { ObstacleEntityInspector } from './components/ObstacleEntityInspector';
import { RegionGenerationPanel } from './components/RegionGenerationPanel';
import { PlanReviewCanvas, type MapPlanSelection } from './components/PlanReviewCanvas';
import { MapSourcePanel } from './components/MapSourcePanel';
import { MapToolbar, type MapTool } from './components/MapToolbar';
import { useMapSources } from './hooks/useMapSources';
import { useMapDraft } from './hooks/useMapDraft';
import { useMapGeneration, type MapGenerationAsset } from './hooks/useMapGeneration';
import {
  createMapPlanEditorState,
  reduceMapPlanCommand,
  redoMapPlan,
  undoMapPlan,
  type MapPlanCommand,
} from './model/mapPlanReducer';
import { validateMapPlanV2, type MapPlanV2 } from './model/mapPlanSchema';
import type { MapSceneV2 } from './model/mapSceneSchema';
import {
  createEditorState,
  reduceEditorCommand,
  redo,
  undo,
  type EditorSelection,
  type MapSceneV2Command,
} from './model/mapSceneReducer';
import { createMapService, type MapSourceToken } from './services/createMapService';
import { useRegionObstacleGeneration, type MapRegionSelection } from './hooks/useRegionObstacleGeneration';
import styles from './CreateMapWorkbench.module.css';

export type CreateMapWorkbenchMode = 'plan-review' | 'scene';

type LoadedAssetImage = { url: string; image: HTMLImageElement };

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
  const [mode, setMode] = useState<CreateMapWorkbenchMode>('plan-review');
  const [planReview, setPlanReview] = useState(() => createMapPlanEditorState(INITIAL_PLAN_V2));
  const [planSelection, setPlanSelection] = useState<MapPlanSelection>(null);
  const [sceneSelection, setSceneSelection] = useState<EditorSelection>(null);
  const [regionSelection, setRegionSelection] = useState<MapRegionSelection | null>(null);
  const [description, setDescription] = useState(
    'A compact top-down village market with grass, an earth road, and movable trees.'
  );
  const [projectId, setProjectId] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [sourceToken, setSourceToken] = useState<MapSourceToken | null>(null);
  const [sceneEditor, setSceneEditor] = useState(() => createEditorState(createEmptySceneV2(INITIAL_PLAN_V2)));
  const [loadedImages, setLoadedImages] = useState<ReadonlyMap<string, LoadedAssetImage>>(() => new Map());
  const [regionAssets, setRegionAssets] = useState<ReadonlyMap<string, MapGenerationAsset>>(() => new Map());
  const [operation, setOperation] = useState<'idle' | 'planning'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<MapTool>('select');
  const [viewport, setViewport] = useState({ zoom: 1, panX: 24, panY: 24 });
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  const sources = useMapSources(projectId);
  const scene = sceneEditor.present;
  const draft = useMapDraft(planReview.present, scene);
  const installMaterializedScene = useCallback((nextScene: MapSceneV2) => {
    setSceneEditor(createEditorState(nextScene));
    setViewport({ zoom: nextScene.canvas.zoom, panX: nextScene.canvas.panX, panY: nextScene.canvas.panY });
    setSnapToGrid(nextScene.canvas.snapToGrid);
    setSceneSelection(null);
    setTool('select');
    setMode('scene');
  }, []);
  const generation = useMapGeneration({
    projectId,
    plan: planReview.present,
    scene,
    canPrepare: Boolean(draft.identity) && draft.status === 'saved' && !draft.isDirty,
    publishForGeneration: draft.publishForGeneration,
    onSceneMaterialized: installMaterializedScene,
  });
  const commitRegionObstacle = useCallback((
    entity: MapSceneV2['obstacleEntities'][number],
    asset: MapGenerationAsset,
  ) => {
    setSceneEditor((current) => reduceEditorCommand(current, { type: 'entity/add', entity }));
    setRegionAssets((current) => new Map(current).set(asset.assetKey, asset));
    setSceneSelection({ kind: 'entity', id: entity.id });
    setMode('scene');
    setTool('select');
  }, []);
  const regionGeneration = useRegionObstacleGeneration({
    projectId,
    plan: planReview.present,
    scene,
    target: generation.target,
    background: generation.assets.find((asset) => asset.kind === 'background') ?? null,
    selection: regionSelection,
    onCommit: commitRegionObstacle,
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
  const selectedEntity = sceneSelection?.kind === 'entity'
    ? scene.obstacleEntities.find((entity) => entity.id === sceneSelection.id) ?? null
    : null;

  const changeRegionSelection = (next: MapRegionSelection | null) => {
    if (regionGeneration.phase === 'submitting' || regionGeneration.phase === 'generating') return;
    regionGeneration.reset();
    setRegionSelection(next);
  };

  const imageAssets = useMemo(
    () => {
      const merged = new Map(generation.assets.map((asset) => [asset.assetKey, asset]));
      regionAssets.forEach((asset, key) => merged.set(key, asset));
      if (regionGeneration.asset) merged.set(regionGeneration.asset.assetKey, regionGeneration.asset);
      return [...merged.values()];
    },
    [generation.assets, regionAssets, regionGeneration.asset],
  );
  const signedImageKey = imageAssets
    .map((asset) => `${asset.assetKey}:${asset.signedUrl ?? ''}`)
    .join('|');

  useEffect(() => {
    let active = true;
    const ready = imageAssets.filter((asset) => asset.signedUrl);
    setLoadedImages(new Map());
    ready.forEach((asset) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        if (!active || !asset.signedUrl) return;
        setLoadedImages((current) => {
          const next = new Map(current);
          next.set(asset.assetKey, { url: asset.signedUrl as string, image });
          return next;
        });
      };
      image.src = asset.signedUrl as string;
    });
    return () => { active = false; };
  }, [imageAssets, signedImageKey]);

  const renderAssets = useMemo(() => {
    const next = new Map<string, MapRenderAsset>();
    imageAssets.forEach((asset) => {
      if (asset.kind !== 'background' && asset.kind !== 'obstacle') return;
      const loaded = loadedImages.get(asset.assetKey);
      const definition = planReview.present.obstacleAssets.find((candidate) => candidate.assetKey === asset.assetKey);
      next.set(asset.assetKey, {
        assetKey: asset.assetKey,
        kind: asset.kind,
        image: loaded?.url === asset.signedUrl ? loaded.image : undefined,
        width: asset.width ?? definition?.size.width ?? scene.size.width,
        height: asset.height ?? definition?.size.height ?? scene.size.height,
      });
    });
    return next;
  }, [imageAssets, loadedImages, planReview.present.obstacleAssets, scene.size.height, scene.size.width]);

  const dispatchPlan = (command: MapPlanCommand) => {
    setPlanReview((current) => reduceMapPlanCommand(current, command));
  };

  const dispatchScene = (command: MapSceneV2Command) => {
    setSceneEditor((current) => reduceEditorCommand(current, command));
    if (command.type === 'entity/delete' && sceneSelection?.kind === 'entity' && sceneSelection.id === command.id) {
      setSceneSelection(null);
    }
  };

  const changeMode = (nextMode: CreateMapWorkbenchMode) => {
    if (nextMode === 'scene' && !scene.background) return;
    setMode(nextMode);
    setTool('select');
  };

  const changeTool = (nextTool: MapTool) => {
    setTool(nextTool);
    if (nextTool.startsWith('collision-')) {
      dispatchScene({ type: 'layer/visibility', layerId: 'collision', visible: true });
    }
  };

  const handleProjectChange = (nextProjectId: string) => {
    if (nextProjectId === projectId) return;
    setProjectId(nextProjectId);
    setDocumentId('');
    setSourceToken(null);
    draft.reset();
    generation.reset();
    regionGeneration.reset();
    setRegionAssets(new Map());
    setRegionSelection(null);
    setMode('plan-review');
    setSceneSelection(null);
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
      setPlanSelection(null);
      setSceneSelection(null);
      setSourceToken(created.sourceToken);
      const nextScene = createEmptySceneV2(created.plan);
      setSceneEditor(createEditorState(nextScene));
      draft.reset();
      generation.reset();
      regionGeneration.reset();
      setRegionAssets(new Map());
      setRegionSelection(null);
      setTool('select');
      setMode('plan-review');
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
        {mode === 'plan-review' ? (
          <PlanStructure
            plan={planReview.present}
            selection={planSelection}
            onSelectionChange={setPlanSelection}
          />
        ) : (
          <MapLayerList
            scene={scene}
            selection={sceneSelection}
            onSelect={setSceneSelection}
            onVisibilityChange={(layerId, visible) => dispatchScene({
              type: 'layer/visibility',
              layerId,
              visible,
            })}
          />
        )}
      </aside>

      <section className={styles.canvasPanel} aria-label="Map canvas">
        <header className={styles.canvasHeader}>
          <div>
            <span className={styles.eyebrow}>{mode === 'plan-review' ? 'Plan Review' : 'Scene Editor'}</span>
            <h2>{planReview.present.name}</h2>
          </div>
          <div className={styles.headerActions}>
            <div className={styles.modeSwitch} role="tablist" aria-label="Map editor mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'plan-review'}
                onClick={() => changeMode('plan-review')}
              >
                Plan
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'scene'}
                disabled={!scene.background}
                onClick={() => changeMode('scene')}
              >
                Scene
              </button>
            </div>
            <div className={styles.saveIndicator} data-status={saveStatus.status}>
              <span aria-hidden />
              {saveStatus.label}
            </div>
          </div>
        </header>
        <MapToolbar
          mode={mode}
          tool={tool}
          zoom={viewport.zoom}
          canUndo={mode === 'plan-review' ? planReview.past.length > 0 : sceneEditor.past.length > 0}
          canRedo={mode === 'plan-review' ? planReview.future.length > 0 : sceneEditor.future.length > 0}
          snapToGrid={snapToGrid}
          hasEntitySelection={selectedEntity !== null}
          onToolChange={changeTool}
          onUndo={() => {
            if (mode === 'plan-review') setPlanReview((current) => undoMapPlan(current));
            else setSceneEditor((current) => undo(current));
          }}
          onRedo={() => {
            if (mode === 'plan-review') setPlanReview((current) => redoMapPlan(current));
            else setSceneEditor((current) => redo(current));
          }}
          onZoomChange={(zoom) => setViewport((current) => ({ ...current, zoom }))}
          onSnapChange={setSnapToGrid}
          onToggleLeft={() => setLeftOpen((open) => !open)}
          onToggleRight={() => setRightOpen((open) => !open)}
        />
        {mode === 'plan-review' ? (
          <PlanReviewCanvas
            plan={planReview.present}
            selection={planSelection}
            issues={issues}
            viewport={viewport}
            onCommand={dispatchPlan}
            onSelectionChange={setPlanSelection}
          />
        ) : (
          <MapCanvas
            scene={scene}
            assets={renderAssets}
            tool={tool}
            viewport={viewport}
            snapToGrid={snapToGrid}
            selection={sceneSelection}
            onCommand={dispatchScene}
            onSelectionChange={setSceneSelection}
            onViewportChange={setViewport}
            regionSelection={regionSelection}
            regionSelectionLocked={regionGeneration.phase === 'submitting' || regionGeneration.phase === 'generating'}
            onRegionSelectionChange={changeRegionSelection}
          />
        )}
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
        {mode === 'plan-review' ? (
          <MapPlanInspector
            plan={planReview.present}
            selection={planSelection}
            issues={issues}
            onCommand={dispatchPlan}
          />
        ) : selectedEntity ? (
          <ObstacleEntityInspector
            entity={selectedEntity}
            onMove={(position) => dispatchScene({ type: 'entity/move', id: selectedEntity.id, position })}
            onTransform={(scale, rotation) => dispatchScene({
              type: 'entity/transform', id: selectedEntity.id, scale, rotation,
            })}
            onZIndexChange={(zIndex) => dispatchScene({
              type: 'entity/z-order', id: selectedEntity.id, zIndex,
            })}
            onCollisionChange={(collision) => dispatchScene({
              type: 'entity/collision', id: selectedEntity.id, collision,
            })}
            onDuplicate={() => {
              const newId = `${selectedEntity.id}-copy-${crypto.randomUUID().slice(0, 8)}`;
              dispatchScene({
                type: 'entity/duplicate',
                id: selectedEntity.id,
                newId,
                offset: { x: scene.size.tileSize, y: scene.size.tileSize },
              });
              setSceneSelection({ kind: 'entity', id: newId });
            }}
            onDelete={() => dispatchScene({ type: 'entity/delete', id: selectedEntity.id })}
          />
        ) : (
          <section className={styles.inspectorSection} aria-labelledby="scene-inspector-heading">
            <h2 id="scene-inspector-heading" className={styles.sectionTitleSmall}>Scene inspector</h2>
            <p className={styles.emptyState}>Select an obstacle to edit its transform and collision.</p>
          </section>
        )}
        {mode === 'scene' ? (
          <RegionGenerationPanel
            {...regionGeneration}
            onClearSelection={() => changeRegionSelection(null)}
          />
        ) : null}
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
