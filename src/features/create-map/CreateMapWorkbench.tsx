'use client';

import { CloseOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';
import { AssetGenerationPanel } from './components/AssetGenerationPanel';
import { InpaintInspector } from './components/InpaintInspector';
import { MapCanvas, type MapRenderAsset } from './components/MapCanvas';
import { MapLayerList } from './components/MapLayerList';
import { MapPlanInspector } from './components/MapPlanInspector';
import { MapSourcePanel } from './components/MapSourcePanel';
import { SavedMapsPanel } from './components/SavedMapsPanel';
import { MapStages, type MapStage } from './components/MapStages';
import { MapToolbar, type MapTool } from './components/MapToolbar';
import { ObjectInspector } from './components/ObjectInspector';
import { ObstacleInspector } from './components/ObstacleInspector';
import { validateMapPlan, type MapPlan } from './model/mapPlanSchema';
import { createEditorState, reduceEditorCommand, redo, undo, type EditorCommand, type EditorSelection } from './model/mapSceneReducer';
import type { MapScene } from './model/mapSceneSchema';
import { useMapDraft } from './hooks/useMapDraft';
import { useMapGeneration } from './hooks/useMapGeneration';
import { useMapSources } from './hooks/useMapSources';
import { useSavedMaps } from './hooks/useSavedMaps';
import { createMapService, createSceneFromPlan, type SavedMapSummary } from './services/createMapService';
import styles from './CreateMapWorkbench.module.css';

const INITIAL_PLAN: MapPlan = {
  schemaVersion: 1,
  name: 'Untitled map',
  visualBrief: 'A readable top-down village clearing with an earth road and movable natural props.',
  map: {
    width: 640,
    height: 448,
    tileSize: 32,
    projection: 'top-down',
    palette: ['#7f9c68', '#b59a6c', '#4f6f57'],
    stylePrompt: 'Top-down pixel art with clear paths, quiet natural color, and crisp object silhouettes.',
  },
  terrains: [
    { assetKey: 'meadow-grass', name: 'Meadow grass', prompt: 'Seamless meadow grass Wang tileset.', weight: 0.8, transitionKeys: ['packed-earth'] },
    { assetKey: 'packed-earth', name: 'Packed earth', prompt: 'Packed earth path terrain with grass transitions.', weight: 0.2, transitionKeys: ['meadow-grass'] },
  ],
  roads: [{ assetKey: 'village-road', name: 'Village road', prompt: 'Earth road set for meadow terrain.', terrainKey: 'packed-earth', width: 32, points: [{ x: 0, y: 224 }, { x: 640, y: 224 }] }],
  objects: [{ assetKey: 'oak-tree', name: 'Oak tree', prompt: 'Transparent top-down oak tree.', size: { width: 64, height: 80 }, groundAnchor: { x: 32, y: 72 }, movable: true }],
  objectInstances: [{ id: 'tree-1', assetKey: 'oak-tree', position: { x: 448, y: 160 }, scale: 1, rotation: 0, zIndex: 10 }],
  obstacles: [{ id: 'pond-edge', shape: 'circle', cx: 160, cy: 320, radius: 48 }],
};

function createInitialScene(): MapScene {
  const columns = INITIAL_PLAN.map.width / INITIAL_PLAN.map.tileSize;
  const rows = INITIAL_PLAN.map.height / INITIAL_PLAN.map.tileSize;
  const tiles: MapScene['tiles'] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const road = y === 6 || y === 7;
      tiles.push({ id: `tile-${x}-${y}`, layerId: 'terrain', terrainKey: road ? 'village-road' : 'meadow-grass', x, y, wangIndex: road ? 1 : 0 });
    }
  }
  return {
    schemaVersion: 1,
    size: { width: INITIAL_PLAN.map.width, height: INITIAL_PLAN.map.height, tileSize: INITIAL_PLAN.map.tileSize },
    layers: [
      { id: 'terrain', name: 'Terrain and roads', kind: 'terrain', visible: true, locked: false },
      { id: 'objects', name: 'Movable objects', kind: 'objects', visible: true, locked: false },
      { id: 'overlay', name: 'Obstacles', kind: 'overlay', visible: true, locked: false },
    ],
    tiles,
    objects: [{ id: 'tree-1', layerId: 'objects', assetKey: 'oak-tree', position: { x: 448, y: 160 }, scale: 1, rotation: 0, zIndex: 10, groundAnchor: { x: 32, y: 72 }, movable: true }],
    obstacles: INITIAL_PLAN.obstacles,
    canvas: { zoom: 1, panX: 24, panY: 24, snapToGrid: true },
  };
}

const STAGES: MapStage[] = [
  { id: 'plan', label: 'Map plan', detail: 'Review structure and resources', status: 'active' },
  { id: 'terrain', label: 'Terrain and roads', detail: 'Wang tiles and path set', status: 'pending' },
  { id: 'objects', label: 'Movable objects', detail: 'Transparent resource images', status: 'pending' },
  { id: 'compose', label: 'Compose', detail: 'Place, edit, and revise', status: 'pending' },
];

export function CreateMapWorkbench() {
  const supabase = useSupabase();
  const [plan, setPlan] = useState<MapPlan>(INITIAL_PLAN);
  const [editor, setEditor] = useState(() => createEditorState(createInitialScene()));
  const [selection, setSelection] = useState<EditorSelection>({ kind: 'object', id: 'tree-1' });
  const [tool, setTool] = useState<MapTool>('select');
  const [contentTab, setContentTab] = useState<'layers' | 'assets' | 'objects'>('layers');
  const [mode, setMode] = useState<'new' | 'regenerate'>('new');
  const [projectId, setProjectId] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [viewport, setViewport] = useState({ zoom: 1, panX: 24, panY: 24 });
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [inpaintPrompt, setInpaintPrompt] = useState('');
  const [brushSize, setBrushSize] = useState(28);
  const [maskReady, setMaskReady] = useState(false);
  const [planRequest, setPlanRequest] = useState<'idle' | 'loading'>('idle');
  const [planError, setPlanError] = useState<string | null>(null);
  const openRequestRef = useRef(0);
  const [openingMapId, setOpeningMapId] = useState<string | null>(null);
  const [openMapError, setOpenMapError] = useState<string | null>(null);

  const service = useMemo(() => createMapService(supabase), [supabase]);
  const sources = useMapSources(projectId);
  const savedMaps = useSavedMaps();
  const draft = useMapDraft(plan, editor.present);

  const validation = useMemo(() => validateMapPlan(plan), [plan]);
  const issues = 'issues' in validation ? validation.issues : [];
  const generation = useMapGeneration({
    projectId,
    plan,
    canPrepare: validation.success && Boolean(draft.identity) && draft.status === 'saved' && !draft.isDirty,
    publishForGeneration: draft.publishForGeneration,
  });
  const [generatedImages, setGeneratedImages] = useState<Map<string, HTMLImageElement>>(() => new Map());
  useEffect(() => {
    const ready = generation.assets.filter((asset) => asset.signedUrl && !generatedImages.has(asset.assetKey));
    if (!ready.length) return;
    let active = true;
    ready.forEach((asset) => {
      const image = new Image();
      image.onload = () => {
        if (!active) return;
        setGeneratedImages((current) => new Map(current).set(asset.assetKey, image));
      };
      image.src = asset.signedUrl as string;
    });
    return () => { active = false; };
  }, [generatedImages, generation.assets]);
  const selectedObject = selection?.kind === 'object' ? editor.present.objects.find((object) => object.id === selection.id) : undefined;
  const selectedObstacle = selection?.kind === 'obstacle' ? editor.present.obstacles.find((obstacle) => obstacle.id === selection.id) : undefined;
  const renderAssets = useMemo(() => {
    const assets = new Map<string, MapRenderAsset>();
    plan.terrains.forEach((terrain, index) => assets.set(terrain.assetKey, {
      assetKey: terrain.assetKey,
      kind: 'terrain',
      color: plan.map.palette[index % plan.map.palette.length] ?? '#7f9c68',
      image: generatedImages.get(terrain.assetKey),
    }));
    plan.roads.forEach((road) => assets.set(road.assetKey, {
      assetKey: road.assetKey,
      kind: 'road',
      underlayAssetKey: road.terrainKey,
      color: '#a88d68',
      image: generatedImages.get(road.assetKey),
    }));
    plan.objects.forEach((object) => assets.set(object.assetKey, {
      assetKey: object.assetKey,
      kind: 'object',
      color: '#42694d',
      width: object.size.width,
      height: object.size.height,
      image: generatedImages.get(object.assetKey),
    }));
    return assets;
  }, [generatedImages, plan]);

  const generationAssets = generation.assets;
  const generationPhase = generation.phase;
  const stages = useMemo<MapStage[]>(() => {
    const terrainAssets = generationAssets.filter((asset) => asset.kind === 'terrain' || asset.kind === 'road');
    const objectAssets = generationAssets.filter((asset) => asset.kind === 'object');
    const statusFor = (assets: typeof generationAssets): MapStage['status'] => {
      if (!assets.length) return 'complete';
      if (assets.some((asset) => asset.status === 'failed' || asset.status === 'blocked')) return 'error';
      if (assets.every((asset) => asset.status === 'ready')) return 'complete';
      if (assets.some((asset) => asset.status === 'queued' || asset.status === 'generating')) return 'active';
      return 'pending';
    };
    return [
      { ...STAGES[0], status: validation.success && draft.identity ? 'complete' : 'active' },
      { ...STAGES[1], status: statusFor(terrainAssets) },
      { ...STAGES[2], status: statusFor(objectAssets) },
      { ...STAGES[3], status: generationPhase === 'ready' || generationPhase === 'partial' ? 'active' : 'pending' },
    ];
  }, [draft.identity, generationAssets, generationPhase, validation.success]);

  const dispatch = (command: EditorCommand) => setEditor((current) => reduceEditorCommand(current, command));
  const closeDrawers = () => { setLeftOpen(false); setRightOpen(false); };
  const createPlan = async () => {
    if (!projectId || !documentId) return;
    setPlanRequest('loading');
    setPlanError(null);
    try {
      const created = await service.createPlan(projectId, documentId);
      const scene = createSceneFromPlan(created.plan);
      await draft.create(projectId, created.sourceToken, created.plan, scene);
      setPlan(created.plan);
      setEditor(createEditorState(scene));
      setSelection(null);
      generation.reset();
      void savedMaps.refetch();
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : 'Could not create map plan');
    } finally {
      setPlanRequest('idle');
    }
  };
  const reloadDraft = async () => {
    const loaded = await draft.reload();
    if (!loaded) return;
    setPlan(loaded.plan);
    setEditor(createEditorState(loaded.scene));
    setSelection(null);
  };
  const canSwitchMaps = !draft.isDirty && !['creating', 'saving', 'conflict'].includes(draft.status);
  const openSavedMap = async (summary: SavedMapSummary) => {
    if (!canSwitchMaps || summary.id === draft.identity?.mapId) return;
    const request = ++openRequestRef.current;
    setOpeningMapId(summary.id);
    setOpenMapError(null);
    try {
      const loaded = await service.loadSavedMap(summary.id);
      const prepared = await generation.prepareRestore({
        mapId: loaded.identity.mapId,
        revisionId: loaded.assetRevisionId,
        plan: loaded.plan,
        records: loaded.assets,
      });
      if (request !== openRequestRef.current) return;
      setProjectId(loaded.projectId);
      setDocumentId(loaded.sourceDocumentId);
      setPlan(loaded.plan);
      setEditor(createEditorState(loaded.scene));
      setSelection(null);
      setTool('select');
      setContentTab('layers');
      setViewport({
        zoom: loaded.scene.canvas.zoom,
        panX: loaded.scene.canvas.panX,
        panY: loaded.scene.canvas.panY,
      });
      setSnapToGrid(loaded.scene.canvas.snapToGrid);
      setMaskReady(false);
      setGeneratedImages(new Map());
      draft.install(loaded);
      generation.installRestore(prepared);
    } catch (cause) {
      if (request === openRequestRef.current) {
        setOpenMapError(cause instanceof Error ? cause.message : 'Could not open saved map');
      }
    } finally {
      if (request === openRequestRef.current) setOpeningMapId(null);
    }
  };

  return (
    <main className={styles.workbench} data-testid="create-map-workbench">
      {(leftOpen || rightOpen) ? <button type="button" className={styles.drawerScrim} aria-label="Close side panels" onClick={closeDrawers} /> : null}
      <aside className={`${styles.leftPanel} ${leftOpen ? styles.drawerOpen : ''}`} aria-label="Map source and layers">
        <button type="button" className={styles.drawerClose} aria-label="Close source panel" onClick={() => setLeftOpen(false)}><CloseOutlined /></button>
        <MapSourcePanel
          projects={sources.projects}
          documents={sources.documents}
          projectId={projectId}
          documentId={documentId}
          mode={mode}
          onProjectChange={(id) => { setProjectId(id); setDocumentId(''); }}
          onDocumentChange={setDocumentId}
          onModeChange={setMode}
          onCreatePlan={() => void createPlan()}
          busy={planRequest === 'loading' || draft.status === 'creating'}
          error={planError ?? (sources.error instanceof Error ? sources.error.message : null)}
        />
        <SavedMapsPanel
          maps={savedMaps.maps}
          isLoading={savedMaps.isLoading}
          error={openMapError ?? (savedMaps.error instanceof Error ? savedMaps.error.message : null)}
          activeMapId={draft.identity?.mapId ?? null}
          openingMapId={openingMapId}
          disabled={!canSwitchMaps}
          onOpen={(summary) => void openSavedMap(summary)}
          onRetry={() => void savedMaps.refetch()}
        />
        <MapStages stages={stages} />
        <MapLayerList
          scene={editor.present}
          tab={contentTab}
          assets={generation.assets}
          selection={selection}
          retryStatus={`${generation.readyCount}/${generation.totalCount} ready`}
          onTabChange={setContentTab}
          onSelect={setSelection}
          onVisibilityChange={(layerId, visible) => dispatch({ type: 'layer/visibility', layerId, visible })}
          onReorder={(layerId, toIndex) => dispatch({ type: 'layer/reorder', layerId, toIndex })}
          onRetry={(assetId) => void generation.retry(assetId)}
        />
      </aside>

      <section className={styles.canvasPanel} aria-label="Map canvas">
        <header className={styles.canvasHeader}>
          <div><span className={styles.eyebrow}>Workspace</span><h2>{plan.name}</h2></div>
          <div className={styles.saveCluster}>
            <div className={styles.saveIndicator} data-status={draft.status}><span aria-hidden />{
              draft.status === 'saving' || draft.status === 'creating' ? 'Saving...'
                : draft.status === 'conflict' ? 'Save conflict'
                  : draft.status === 'error' ? 'Save failed'
                    : draft.identity ? 'All changes saved' : 'Local preview'
            }</div>
            {draft.status === 'conflict' ? (
              <div className={styles.saveActions}>
                <button type="button" onClick={() => void reloadDraft()}>Reload</button>
                <button type="button" onClick={() => void draft.saveAsNewRevision()}>Save as new revision</button>
              </div>
            ) : null}
          </div>
        </header>
        <MapToolbar
          tool={tool}
          zoom={viewport.zoom}
          canUndo={editor.past.length > 0}
          canRedo={editor.future.length > 0}
          snapToGrid={snapToGrid}
          onToolChange={setTool}
          onUndo={() => setEditor((current) => undo(current))}
          onRedo={() => setEditor((current) => redo(current))}
          onZoomChange={(zoom) => setViewport((current) => ({ ...current, zoom }))}
          onSnapChange={setSnapToGrid}
          onToggleLeft={() => setLeftOpen((open) => !open)}
          onToggleRight={() => setRightOpen((open) => !open)}
        />
        <MapCanvas
          key={draft.identity?.mapId ?? 'local-preview'}
          scene={editor.present}
          assets={renderAssets}
          tool={tool}
          viewport={viewport}
          snapToGrid={snapToGrid}
          selection={selection}
          onCommand={dispatch}
          onSelectionChange={setSelection}
          onViewportChange={setViewport}
          onMaskPaint={() => setMaskReady(true)}
        />
      </section>

      <aside className={`${styles.rightPanel} ${rightOpen ? styles.drawerOpen : ''}`} aria-label="Map plan and inspector">
        <button type="button" className={styles.drawerClose} aria-label="Close inspector panel" onClick={() => setRightOpen(false)}><CloseOutlined /></button>
        <MapPlanInspector plan={plan} issues={issues} onPlanChange={setPlan} />
        <AssetGenerationPanel
          assets={generation.assets}
          phase={generation.phase}
          error={generation.error}
          readyCount={generation.readyCount}
          failedCount={generation.failedCount}
          canPrepare={generation.canPrepare}
          onPrepare={() => void generation.prepare()}
          onConfirm={() => void generation.confirm()}
          onRetry={(assetId) => void generation.retry(assetId)}
        />
        {selectedObject ? <ObjectInspector object={selectedObject} onMove={(position) => dispatch({ type: 'object/move', id: selectedObject.id, position })} onTransform={(scale, rotation) => dispatch({ type: 'object/transform', id: selectedObject.id, scale, rotation })} /> : null}
        {selectedObstacle ? <ObstacleInspector obstacle={selectedObstacle} onChange={(obstacle) => dispatch({ type: 'obstacle/update', obstacle })} onDelete={() => { dispatch({ type: 'obstacle/delete', id: selectedObstacle.id }); setSelection(null); }} /> : null}
        <InpaintInspector
          prompt={inpaintPrompt}
          brushSize={brushSize}
          maskReady={maskReady}
          onPromptChange={setInpaintPrompt}
          onBrushSizeChange={setBrushSize}
          onSubmit={() => undefined}
          onApply={() => setMaskReady(false)}
          onRollback={() => setMaskReady(false)}
        />
      </aside>
    </main>
  );
}
