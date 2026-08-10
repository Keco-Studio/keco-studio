'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';
import { deriveInitialLocalCollision, type ObstacleAlphaMetrics } from '../model/obstacleCollision';
import type { MapPlanV2 } from '../model/mapPlanSchema';
import type { MapSceneV2, ObstacleEntity } from '../model/mapSceneSchema';
import {
  clampMapRegionSelection,
  type MapRegionSelection,
} from '../model/mapRegionSelection';
import type { MapGenerationAsset, GenerationTarget } from './useMapGeneration';
import { generationTargetMatches } from './useMapGeneration';
import { createMapService, type MapAssetRecord } from '../services/createMapService';

export { clampMapRegionSelection };
export type { MapRegionSelection };

export type RegionObstaclePhase =
  | 'empty'
  | 'prompt-ready'
  | 'submitting'
  | 'generating'
  | 'failed'
  | 'ready';

export type RegionObstacleGenerationInput = {
  projectId: string;
  plan: MapPlanV2;
  scene: MapSceneV2;
  target: GenerationTarget | null;
  background: MapGenerationAsset | null;
  selection: MapRegionSelection | null;
  onCommit: (entity: ObstacleEntity, asset: MapGenerationAsset) => void;
};

export type RegionObstacleGenerationState = {
  selection: MapRegionSelection | null;
  prompt: string;
  phase: RegionObstaclePhase;
  error: string | null;
  asset: MapGenerationAsset | null;
  setPrompt: (prompt: string) => void;
  generate: () => Promise<void>;
  reset: () => void;
};

export function fitObstacleToRegion(
  selection: MapRegionSelection,
  asset: { width: number; height: number },
): { scale: number; position: { x: number; y: number }; groundAnchor: { x: number; y: number } } {
  if (asset.width <= 0 || asset.height <= 0 || selection.width <= 0 || selection.height <= 0) {
    throw new RangeError('A positive selection and asset size are required');
  }
  const scale = Math.min(selection.width / asset.width, selection.height / asset.height);
  return {
    scale,
    position: { x: selection.x + selection.width / 2, y: selection.y + selection.height },
    groundAnchor: { x: asset.width / 2, y: asset.height },
  };
}

export function regionObstacleRequestMatches(
  currentTarget: GenerationTarget | null,
  expectedTarget: GenerationTarget,
  currentEpoch: number,
  expectedEpoch: number,
): boolean {
  return currentEpoch === expectedEpoch && generationTargetMatches(currentTarget, expectedTarget);
}

function metricNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metricsFromRecord(record: MapAssetRecord): ObstacleAlphaMetrics {
  const metadata = record.metadata;
  const alpha = metadata.alphaBounds;
  const alphaBounds = alpha && typeof alpha === 'object'
    ? {
        x: metricNumber((alpha as Record<string, unknown>).x) ?? 0,
        y: metricNumber((alpha as Record<string, unknown>).y) ?? 0,
        width: metricNumber((alpha as Record<string, unknown>).width) ?? 0,
        height: metricNumber((alpha as Record<string, unknown>).height) ?? 0,
      }
    : null;
  return {
    alphaBounds,
    opaquePixelCount: metricNumber(metadata.opaquePixelCount) ?? 0,
    visiblePixelCount: metricNumber(metadata.visiblePixelCount) ?? 0,
    opaqueFillRatio: metricNumber(metadata.opaqueFillRatio) ?? 0,
  };
}

export function materializeRegionObstacleEntity(
  selection: MapRegionSelection,
  record: MapAssetRecord,
  scene: MapSceneV2,
): ObstacleEntity {
  if (!record.width || !record.height || record.status !== 'ready') {
    throw new Error('A ready obstacle image with dimensions is required');
  }
  const fitted = fitObstacleToRegion(selection, { width: record.width, height: record.height });
  return {
    id: `region-entity-${record.id}`,
    layerId: 'obstacles',
    assetKey: record.asset_key,
    position: fitted.position,
    scale: fitted.scale,
    rotation: 0,
    zIndex: Math.max(0, ...scene.obstacleEntities.map((entity) => entity.zIndex)) + 1,
    groundAnchor: fitted.groundAnchor,
    collision: deriveInitialLocalCollision(metricsFromRecord(record), fitted.groundAnchor),
    source: 'region-generation',
  };
}

function assetFromRecord(record: MapAssetRecord, row: {
  assetKey: string;
  prompt: string;
  generationParams: Record<string, unknown>;
  metadata: Record<string, unknown>;
}): MapGenerationAsset {
  return {
    assetKey: row.assetKey,
    kind: 'obstacle',
    prompt: row.prompt,
    requestedCapability: 'map_object',
    generationParams: row.generationParams,
    metadata: row.metadata,
    id: record.id,
    status: record.status,
    attemptCount: record.attempt_count,
    errorCode: record.last_error_code,
    storagePath: record.storage_path,
    sha256: record.sha256,
    width: record.width,
    height: record.height,
    signedUrl: null,
  };
}

function providerSize(value: number): number {
  return Math.max(32, Math.min(400, Math.round(value)));
}

export function useRegionObstacleGeneration({
  projectId,
  plan,
  scene,
  target,
  background,
  selection,
  onCommit,
}: RegionObstacleGenerationInput): RegionObstacleGenerationState {
  const supabase = useSupabase();
  const service = useMemo(() => createMapService(supabase), [supabase]);
  const [prompt, setPrompt] = useState('');
  const [busyPhase, setBusyPhase] = useState<Exclude<RegionObstaclePhase, 'empty' | 'prompt-ready'>>('ready');
  const [error, setError] = useState<string | null>(null);
  const [asset, setAsset] = useState<MapGenerationAsset | null>(null);
  const epochRef = useRef(0);
  const committedAssetRef = useRef<string | null>(null);
  const targetRef = useRef<GenerationTarget | null>(target);
  const sceneRef = useRef(scene);
  targetRef.current = target;
  sceneRef.current = scene;

  const generate = useCallback(async () => {
    const expected = target;
    const requestSelection = selection;
    const requestPrompt = prompt.trim();
    if (!expected || !requestSelection || requestSelection.width <= 0 || requestSelection.height <= 0) {
      setError('Select a positive map region first.');
      return;
    }
    if (!requestPrompt) {
      setError('Describe the obstacle before generating it.');
      return;
    }
    if (!background?.id || !background.sha256 || background.status !== 'ready') {
      setError('The locked background must be ready before generating a regional obstacle.');
      return;
    }
    const epoch = ++epochRef.current;
    const requestIsCurrent = () => regionObstacleRequestMatches(
      targetRef.current,
      expected,
      epochRef.current,
      epoch,
    );
    setBusyPhase('submitting');
    setError(null);
    try {
      const assetKey = asset?.assetKey ?? `region-obstacle-${crypto.randomUUID()}`;
      const generationParams = {
        width: providerSize(requestSelection.width),
        height: providerSize(requestSelection.height),
        transparency: true,
        projection: plan.map.projection,
        palette: plan.background.palette,
        regionSelection: requestSelection,
        source: 'region-generation',
      };
      const metadata = {
        source: 'region-generation',
        regionSelection: requestSelection,
        backgroundAssetId: background.id,
        backgroundSha256: background.sha256,
      };
      const created = await service.createAssetPlanV2({
        revisionId: expected.revisionId,
        generationId: expected.generationId,
        assetKey,
        kind: 'obstacle',
        prompt: requestPrompt,
        requestedCapability: 'map_object',
        generationParams,
        referenceAssetIds: [background.id],
        referenceHashes: [background.sha256],
        planFingerprint: expected.planFingerprint,
        metadata,
      });
      if (!requestIsCurrent()) return;
      const row = { assetKey, prompt: requestPrompt, generationParams, metadata };
      const finishRecord = async (record: MapAssetRecord): Promise<boolean> => {
        const nextAsset = assetFromRecord(record, row);
        if (record.status !== 'ready') {
          setAsset(nextAsset);
          setBusyPhase('failed');
          setError(record.last_error_code ?? 'Regional obstacle generation failed.');
          return true;
        }
        if (record.storage_path) {
          try { nextAsset.signedUrl = await service.createSignedAssetUrl(record.storage_path); }
          catch { nextAsset.signedUrl = null; }
        }
        if (!requestIsCurrent()) return true;
        const entity = materializeRegionObstacleEntity(requestSelection, record, sceneRef.current);
        if (committedAssetRef.current !== record.id) {
          committedAssetRef.current = record.id;
          onCommit(entity, nextAsset);
        }
        setAsset(nextAsset);
        setBusyPhase('ready');
        return true;
      };
      const readBack = await service.readAssetPlan(created.asset_id);
      setAsset(assetFromRecord(readBack, row));
      if (readBack.status === 'ready') {
        await finishRecord(readBack);
        return;
      }
      if (readBack.status === 'planned' || readBack.status === 'failed' || readBack.status === 'blocked') {
        await service.invokePixelLab({
          operation: readBack.status === 'planned' ? 'submit' : 'retry',
          projectId,
          mapId: expected.mapId,
          revisionId: expected.revisionId,
          generationId: expected.generationId,
          assetId: created.asset_id,
        });
      }
      setBusyPhase('generating');
      for (let cycle = 0; cycle < 120; cycle += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 2500));
        if (!requestIsCurrent()) return;
        await service.invokePixelLab({
          operation: 'poll',
          projectId,
          mapId: expected.mapId,
          revisionId: expected.revisionId,
          generationId: expected.generationId,
          assetId: created.asset_id,
        });
        const records = await service.listAssets(expected.revisionId);
        const record = records.find((candidate) => candidate.id === created.asset_id);
        if (!record || record.status === 'queued' || record.status === 'generating') continue;
        if (!requestIsCurrent()) return;
        try {
          if (await finishRecord(record)) return;
        } catch (cause) {
          setBusyPhase('failed');
          setError(cause instanceof Error ? cause.message : 'Could not materialize regional obstacle.');
          return;
        }
      }
      throw new Error('Regional obstacle generation timed out.');
    } catch (cause) {
      if (!requestIsCurrent()) return;
      setBusyPhase('failed');
      setError(cause instanceof Error ? cause.message : 'Could not generate regional obstacle.');
    }
  }, [asset, background, onCommit, plan, projectId, prompt, selection, service, target]);

  const reset = useCallback(() => {
    epochRef.current += 1;
    committedAssetRef.current = null;
    setAsset(null);
    setError(null);
    setBusyPhase('ready');
  }, []);

  const busy = busyPhase === 'submitting' || busyPhase === 'generating';
  const phase: RegionObstaclePhase = busy
    ? busyPhase
    : busyPhase === 'failed'
      ? 'failed'
      : busyPhase === 'ready' && asset
        ? 'ready'
        : selection && prompt.trim()
          ? 'prompt-ready'
          : 'empty';

  return { selection, prompt, phase, error, asset, setPrompt, generate, reset };
}
