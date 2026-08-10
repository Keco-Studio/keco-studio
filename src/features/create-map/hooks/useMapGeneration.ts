'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';
import {
  buildMapAssetPlansV2,
  type MapAssetKindV2,
  type MapAssetPlanRowV2,
} from '../model/mapAssetPlan';
import { validateMapPlanV2, type MapPlanV2 } from '../model/mapPlanSchema';
import type { MapSceneV2, ObstacleEntity } from '../model/mapSceneSchema';
import { createMapService, type MapAssetRecord } from '../services/createMapService';
import { submitMapAssetsInBatches, waitForMapAssetBatch } from '../services/mapGenerationQueue';

export type MapGenerationPhase =
  | 'idle'
  | 'preparing'
  | 'awaiting-confirmation'
  | 'generating-resources'
  | 'composing-background'
  | 'partial'
  | 'ready'
  | 'failed';

export type MapGenerationAssetStatus = MapAssetRecord['status'] | 'unplanned';

export type MapGenerationAsset = MapAssetPlanRowV2 & {
  id: string | null;
  status: MapGenerationAssetStatus;
  attemptCount: number;
  errorCode: string | null;
  storagePath: string | null;
  sha256: string | null;
  signedUrl: string | null;
};

export type GenerationTarget = {
  projectId: string;
  mapId: string;
  revisionId: string;
  generationId: string;
  planFingerprint: string;
};

export type GenerationWatchPlan = { active: boolean; pollAssetIds: string[]; key: string };

export type PreparedGenerationRestore = {
  target: GenerationTarget | null;
  plan: MapPlanV2;
  assets: MapGenerationAsset[];
  phase: MapGenerationPhase;
};

type UseMapGenerationInput = {
  projectId: string;
  plan: MapPlanV2;
  scene: MapSceneV2;
  canPrepare: boolean;
  publishForGeneration: () => Promise<{ mapId: string; publishedRevisionId: string }>;
  onSceneMaterialized: (scene: MapSceneV2) => void;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function mapPlanFingerprint(plan: MapPlanV2): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(plan)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function containsPlannedValue(actual: unknown, planned: unknown): boolean {
  if (Array.isArray(planned)) {
    return Array.isArray(actual)
      && actual.length === planned.length
      && planned.every((value, index) => containsPlannedValue(actual[index], value));
  }
  if (planned && typeof planned === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
    const actualRecord = actual as Record<string, unknown>;
    return Object.entries(planned as Record<string, unknown>).every(([key, value]) =>
      Object.prototype.hasOwnProperty.call(actualRecord, key)
      && containsPlannedValue(actualRecord[key], value)
    );
  }
  return canonical(actual) === canonical(planned);
}

function previewAsset(row: MapAssetPlanRowV2): MapGenerationAsset {
  return {
    ...row,
    id: null,
    status: 'unplanned',
    attemptCount: 0,
    errorCode: null,
    storagePath: null,
    sha256: null,
    signedUrl: null,
  };
}

function verifiedAsset(
  row: MapAssetPlanRowV2,
  record: MapAssetRecord,
  target: Pick<GenerationTarget, 'revisionId' | 'generationId' | 'planFingerprint'>,
): MapGenerationAsset {
  const matches = record.map_revision_id === target.revisionId
    && record.generation_id === target.generationId
    && record.plan_fingerprint === target.planFingerprint
    && record.asset_key === row.assetKey
    && record.kind === row.kind
    && record.prompt === row.prompt
    && record.requested_capability === row.requestedCapability
    && canonical(record.generation_params) === canonical(row.generationParams)
    && containsPlannedValue(record.metadata, row.metadata);
  if (!matches) throw new Error(`Asset plan read-back mismatch: ${row.assetKey}`);
  return {
    ...row,
    id: record.id,
    status: record.status,
    attemptCount: record.attempt_count,
    errorCode: record.last_error_code,
    storagePath: record.storage_path,
    sha256: record.sha256,
    signedUrl: null,
  };
}

export function generationPhaseFor(assets: readonly MapGenerationAsset[]): MapGenerationPhase {
  if (assets.length === 0 || assets.every((asset) => asset.status === 'unplanned')) return 'idle';
  const sources = assets.filter((asset) => asset.kind !== 'background');
  const atlases = sources.filter((asset) => asset.kind === 'terrain' || asset.kind === 'path');
  const obstacles = sources.filter((asset) => asset.kind === 'obstacle');
  const background = assets.find((asset) => asset.kind === 'background');
  const failed = (asset: MapGenerationAsset) => asset.status === 'failed' || asset.status === 'blocked';
  const active = (asset: MapGenerationAsset) => asset.status === 'queued' || asset.status === 'generating';
  if (sources.some((asset) => asset.status === 'planned') && !sources.some(active)) {
    return 'awaiting-confirmation';
  }
  if (atlases.some(failed)) return assets.some((asset) => asset.status === 'ready') ? 'partial' : 'failed';
  if (atlases.some((asset) => asset.status !== 'ready')) return 'generating-resources';
  if (!background || background.status === 'unplanned' || background.status === 'planned' || active(background)) {
    return 'composing-background';
  }
  if (failed(background)) return assets.some((asset) => asset.status === 'ready') ? 'partial' : 'failed';
  if (background.status !== 'ready') return 'composing-background';
  if (obstacles.some(active) || obstacles.some((asset) => asset.status === 'planned')) return 'generating-resources';
  if (obstacles.some(failed)) return 'partial';
  return 'ready';
}

export function generationWatchPlan(assets: readonly MapGenerationAsset[]): GenerationWatchPlan {
  const watched = assets
    .filter((asset) => asset.status === 'queued' || asset.status === 'generating')
    .map((asset) => [asset.status, asset.kind, asset.id] as const)
    .sort(([leftStatus, leftKind, leftId], [rightStatus, rightKind, rightId]) =>
      leftStatus.localeCompare(rightStatus)
      || leftKind.localeCompare(rightKind)
      || (leftId ?? '').localeCompare(rightId ?? '')
    );
  return {
    active: watched.length > 0,
    pollAssetIds: assets.flatMap((asset) =>
      asset.kind !== 'background' && asset.status === 'generating' && asset.id ? [asset.id] : []
    ),
    key: JSON.stringify(watched),
  };
}

type MonitoringService = {
  invokePixelLab: (input: {
    operation: 'poll';
    projectId: string;
    mapId: string;
    revisionId: string;
    generationId: string;
    assetId: string;
  }) => Promise<unknown>;
};

export function useMapGenerationMonitoring({
  watch,
  target,
  service,
  refresh,
  setError,
  submissionActive,
}: {
  watch: GenerationWatchPlan;
  target: GenerationTarget | null;
  service: MonitoringService;
  refresh: (target: GenerationTarget) => Promise<void>;
  setError: (error: string | null) => void;
  submissionActive: { current: boolean };
}): void {
  const pollActive = useRef<number | null>(null);
  const cycleRef = useRef(0);
  const watchRef = useRef(watch);
  watchRef.current = watch;
  const targetKey = target ? `${target.projectId}:${target.mapId}:${target.revisionId}:${target.generationId}` : '';

  useEffect(() => {
    const cycle = ++cycleRef.current;
    if (!target || !watch.active) return;
    const poll = async () => {
      if (submissionActive.current || pollActive.current === cycle) return;
      pollActive.current = cycle;
      try {
        const latest = watchRef.current;
        await Promise.allSettled(latest.pollAssetIds.map((assetId) => service.invokePixelLab({
          operation: 'poll',
          projectId: target.projectId,
          mapId: target.mapId,
          revisionId: target.revisionId,
          generationId: target.generationId,
          assetId,
        })));
        if (cycleRef.current !== cycle) return;
        await refresh(target);
      } catch (cause) {
        if (cycleRef.current === cycle) {
          setError(cause instanceof Error ? cause.message : 'Could not refresh PixelLab progress.');
        }
      } finally {
        if (pollActive.current === cycle) pollActive.current = null;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2500);
    return () => {
      clearInterval(timer);
      if (cycleRef.current === cycle) cycleRef.current += 1;
    };
  }, [refresh, service, setError, submissionActive, target, targetKey, watch.active, watch.key]);
}

export async function prepareGenerationRestore(
  input: { projectId: string; mapId: string; revisionId: string | null; plan: MapPlanV2; records: MapAssetRecord[] },
  createSignedUrl: (storagePath: string) => Promise<string>,
): Promise<PreparedGenerationRestore> {
  const rows = buildMapAssetPlansV2(input.plan);
  if (!input.revisionId || input.records.length === 0) {
    return { target: null, plan: input.plan, assets: rows.map(previewAsset), phase: 'idle' };
  }
  const generationIds = new Set(input.records.flatMap((record) => record.generation_id ? [record.generation_id] : []));
  const planFingerprint = await mapPlanFingerprint(input.plan);
  if (
    generationIds.size !== 1
    || input.records.some((record) =>
      record.map_revision_id !== input.revisionId || record.plan_fingerprint !== planFingerprint
    )
  ) {
    return { target: null, plan: input.plan, assets: rows.map(previewAsset), phase: 'idle' };
  }
  const target: GenerationTarget = {
    projectId: input.projectId,
    mapId: input.mapId,
    revisionId: input.revisionId,
    generationId: [...generationIds][0],
    planFingerprint,
  };
  const byKey = new Map(input.records.map((record) => [record.asset_key, record]));
  let assets: MapGenerationAsset[];
  try {
    assets = rows.map((row) => {
      const record = byKey.get(row.assetKey);
      return record ? verifiedAsset(row, record, target) : previewAsset(row);
    });
  } catch {
    return { target: null, plan: input.plan, assets: rows.map(previewAsset), phase: 'idle' };
  }
  assets = await Promise.all(assets.map(async (asset) => {
    if (asset.status !== 'ready' || !asset.storagePath) return asset;
    try {
      return { ...asset, signedUrl: await createSignedUrl(asset.storagePath) };
    } catch {
      return asset;
    }
  }));
  return { target, plan: input.plan, assets, phase: generationPhaseFor(assets) };
}

export function materializeMapSceneV2(
  plan: MapPlanV2,
  current: MapSceneV2,
  target: GenerationTarget,
  records: readonly MapAssetRecord[],
): MapSceneV2 | null {
  const background = records.find((record) => record.kind === 'background' && record.status === 'ready');
  if (!background) return null;
  const readyObstacleKeys = new Set(records.flatMap((record) =>
    record.kind === 'obstacle' && record.status === 'ready' ? [record.asset_key] : []
  ));
  const definitions = new Map(plan.obstacleAssets.map((asset) => [asset.assetKey, asset]));
  const existing = new Map(current.obstacleEntities.map((entity) => [entity.id, entity]));
  const plannedEntities = plan.obstaclePlacements.flatMap((placement): ObstacleEntity[] => {
    const prior = existing.get(placement.id);
    if (prior) return [prior];
    const definition = definitions.get(placement.assetKey);
    if (!definition || !readyObstacleKeys.has(placement.assetKey)) return [];
    return [{
      id: placement.id,
      layerId: 'obstacles',
      assetKey: placement.assetKey,
      position: placement.position,
      scale: placement.scale,
      rotation: placement.rotation,
      zIndex: placement.zIndex,
      groundAnchor: definition.groundAnchor,
      collision: placement.collision,
      source: 'plan',
    }];
  });
  const plannedIds = new Set(plan.obstaclePlacements.map((placement) => placement.id));
  const preserved = current.obstacleEntities.filter((entity) => !plannedIds.has(entity.id));
  return {
    ...current,
    size: { width: plan.map.width, height: plan.map.height, tileSize: plan.map.tileSize },
    background: {
      layerId: 'background',
      assetKey: background.asset_key,
      sourceRevisionId: target.revisionId,
      width: plan.map.width,
      height: plan.map.height,
      locked: true,
    },
    obstacleEntities: [...preserved, ...plannedEntities],
  };
}

export function generationTargetMatches(left: GenerationTarget | null, right: GenerationTarget): boolean {
  return Boolean(left
    && left.projectId === right.projectId
    && left.mapId === right.mapId
    && left.revisionId === right.revisionId
    && left.generationId === right.generationId);
}

export function generationRetryOperation(
  asset: Pick<MapGenerationAsset, 'kind'>,
): 'compose_background' | 'retry' {
  return asset.kind === 'background' ? 'compose_background' : 'retry';
}

export function useMapGeneration({
  projectId,
  plan,
  scene,
  canPrepare,
  publishForGeneration,
  onSceneMaterialized,
}: UseMapGenerationInput) {
  const supabase = useSupabase();
  const service = useMemo(() => createMapService(supabase), [supabase]);
  const previewRows = useMemo(() => buildMapAssetPlansV2(plan), [plan]);
  const [generationPlan, setGenerationPlan] = useState(plan);
  const [assets, setAssets] = useState<MapGenerationAsset[]>(() => previewRows.map(previewAsset));
  const [phase, setPhase] = useState<MapGenerationPhase>('idle');
  const [target, setTarget] = useState<GenerationTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const targetRef = useRef<GenerationTarget | null>(null);
  targetRef.current = target;
  const submissionActive = useRef(false);
  const compositionLock = useRef('');
  const lifecycleEpoch = useRef(0);
  const watch = generationWatchPlan(assets);

  useEffect(() => {
    if (phase === 'idle') {
      setGenerationPlan(plan);
      setAssets(previewRows.map(previewAsset));
    }
  }, [phase, plan, previewRows]);

  const refresh = useCallback(async (expected: GenerationTarget) => {
    const records = await service.listAssets(expected.revisionId);
    if (!generationTargetMatches(targetRef.current, expected)) return;
    const rows = buildMapAssetPlansV2(generationPlan);
    const byKey = new Map(records.map((record) => [record.asset_key, record]));
    let next = rows.map((row) => {
      const record = byKey.get(row.assetKey);
      return record ? verifiedAsset(row, record, expected) : previewAsset(row);
    });
    setAssets(next);
    setPhase(generationPhaseFor(next));
    const signed = await Promise.all(next.map(async (asset) => {
      if (asset.status !== 'ready' || !asset.storagePath) return asset;
      try { return { ...asset, signedUrl: await service.createSignedAssetUrl(asset.storagePath) }; }
      catch { return asset; }
    }));
    if (!generationTargetMatches(targetRef.current, expected)) return;
    next = signed;
    setAssets(next);
    setPhase(generationPhaseFor(next));
  }, [generationPlan, service]);

  const prepareRestore = useCallback(
    (input: Parameters<typeof prepareGenerationRestore>[0]) =>
      prepareGenerationRestore(input, service.createSignedAssetUrl),
    [service],
  );

  const installRestore = useCallback((prepared: PreparedGenerationRestore) => {
    lifecycleEpoch.current += 1;
    targetRef.current = prepared.target;
    setTarget(prepared.target);
    setGenerationPlan(prepared.plan);
    setAssets(prepared.assets);
    setPhase(prepared.phase);
    setError(null);
    compositionLock.current = '';
  }, []);

  const prepare = useCallback(async () => {
    const validation = validateMapPlanV2(plan);
    if (validation.success === false) {
      setError('Resolve the map plan issues before preparing generation.');
      return;
    }
    if (!projectId || !canPrepare) {
      setError('Wait for the current map draft to finish saving.');
      return;
    }
    setPhase('preparing');
    setError(null);
    const epoch = ++lifecycleEpoch.current;
    try {
      const published = await publishForGeneration();
      if (lifecycleEpoch.current !== epoch) return;
      const generationId = crypto.randomUUID();
      const planFingerprint = await mapPlanFingerprint(validation.data);
      if (lifecycleEpoch.current !== epoch) return;
      const nextTarget: GenerationTarget = {
        projectId,
        mapId: published.mapId,
        revisionId: published.publishedRevisionId,
        generationId,
        planFingerprint,
      };
      const rows = buildMapAssetPlansV2(validation.data);
      const sourceRows = rows.filter((row) => row.kind !== 'background');
      const planned = await Promise.all(sourceRows.map(async (row) => {
        const created = await service.createAssetPlanV2({
          revisionId: nextTarget.revisionId,
          generationId,
          assetKey: row.assetKey,
          kind: row.kind,
          prompt: row.prompt,
          requestedCapability: row.requestedCapability,
          generationParams: row.generationParams,
          referenceAssetIds: [],
          referenceHashes: [],
          planFingerprint,
          metadata: row.metadata,
        });
        const record = await service.readAssetPlan(created.asset_id);
        return verifiedAsset(row, record, nextTarget);
      }));
      if (lifecycleEpoch.current !== epoch) return;
      const nextAssets = [...planned, previewAsset(rows.find((row) => row.kind === 'background') as MapAssetPlanRowV2)];
      targetRef.current = nextTarget;
      setTarget(nextTarget);
      setGenerationPlan(validation.data);
      setAssets(nextAssets);
      setPhase('awaiting-confirmation');
      compositionLock.current = '';
    } catch (cause) {
      if (lifecycleEpoch.current !== epoch) return;
      setPhase('failed');
      setError(cause instanceof Error ? cause.message : 'Could not prepare map resources.');
    }
  }, [canPrepare, plan, projectId, publishForGeneration, service]);

  const confirm = useCallback(async () => {
    const expected = targetRef.current;
    if (!expected || phase !== 'awaiting-confirmation') return;
    const planned = assets.filter((asset): asset is MapGenerationAsset & { id: string } =>
      asset.kind !== 'background' && asset.status === 'planned' && asset.id !== null
    );
    if (planned.length === 0) return;
    setPhase('generating-resources');
    setError(null);
    submissionActive.current = true;
    try {
      const results = await submitMapAssetsInBatches(
        planned,
        async (asset) => {
          if (!generationTargetMatches(targetRef.current, expected)) {
            throw new Error('Map asset batch cancelled.');
          }
          await service.invokePixelLab({
            operation: 'submit',
            projectId: expected.projectId,
            mapId: expected.mapId,
            revisionId: expected.revisionId,
            generationId: expected.generationId,
            assetId: asset.id,
          });
        },
        async (batch, batchResults) => {
          const submittedIds = batchResults.flatMap((result, index) =>
            result.status === 'fulfilled' ? [batch[index].id] : []
          );
          if (submittedIds.length > 0) {
            await waitForMapAssetBatch(
              submittedIds,
              (assetId) => service.invokePixelLab({
                operation: 'poll',
                projectId: expected.projectId,
                mapId: expected.mapId,
                revisionId: expected.revisionId,
                generationId: expected.generationId,
                assetId,
              }).then(() => undefined),
              async () => {
                const records = await service.listAssets(expected.revisionId);
                return new Map(records.map((record) => [record.id, record.status]));
              },
              { shouldContinue: () => generationTargetMatches(targetRef.current, expected) },
            );
          }
          await refresh(expected);
          if (!generationTargetMatches(targetRef.current, expected)) {
            throw new Error('Map asset batch cancelled.');
          }
        },
        4,
      );
      await refresh(expected);
      if (results.some((result) => result.status === 'rejected') && generationTargetMatches(targetRef.current, expected)) {
        setError('Some resources were not submitted. Confirm again to retry the remaining planned resources.');
      }
    } catch (cause) {
      if (generationTargetMatches(targetRef.current, expected)) {
        setError(cause instanceof Error ? cause.message : 'Could not start map resource generation.');
        try { await refresh(expected); } catch { setPhase('failed'); }
      }
    } finally {
      submissionActive.current = false;
    }
  }, [assets, phase, refresh, service]);

  useEffect(() => {
    const expected = target;
    if (!expected) return;
    const atlasAssets = assets.filter((asset) => asset.kind === 'terrain' || asset.kind === 'path');
    const background = assets.find((asset) => asset.kind === 'background');
    if (!background || atlasAssets.length === 0 || atlasAssets.some((asset) =>
      asset.status !== 'ready' || !asset.id || !asset.sha256
    )) return;
    if (!['unplanned', 'planned'].includes(background.status)) return;
    const lockKey = `${expected.revisionId}:${expected.generationId}`;
    if (compositionLock.current === lockKey) return;
    compositionLock.current = lockKey;
    void (async () => {
      try {
        let backgroundAsset = background;
        if (!background.id) {
          const created = await service.createAssetPlanV2({
            revisionId: expected.revisionId,
            generationId: expected.generationId,
            assetKey: background.assetKey,
            kind: 'background',
            prompt: background.prompt,
            requestedCapability: null,
            generationParams: background.generationParams,
            referenceAssetIds: atlasAssets.map((asset) => asset.id as string),
            referenceHashes: atlasAssets.map((asset) => asset.sha256 as string),
            planFingerprint: expected.planFingerprint,
            metadata: background.metadata,
          });
          const record = await service.readAssetPlan(created.asset_id);
          backgroundAsset = verifiedAsset(background, record, expected);
          if (!generationTargetMatches(targetRef.current, expected)) return;
          setAssets((current) => current.map((asset) =>
            asset.kind === 'background' ? backgroundAsset : asset
          ));
        }
        if (!backgroundAsset.id || !generationTargetMatches(targetRef.current, expected)) return;
        setPhase('composing-background');
        await service.invokePixelLab({
          operation: 'compose_background',
          projectId: expected.projectId,
          mapId: expected.mapId,
          revisionId: expected.revisionId,
          generationId: expected.generationId,
          assetId: backgroundAsset.id,
        });
        await refresh(expected);
      } catch (cause) {
        if (!generationTargetMatches(targetRef.current, expected)) return;
        setAssets((current) => current.map((asset) =>
          asset.kind === 'background' ? { ...asset, status: 'failed', errorCode: 'background_composition_failed' } : asset
        ));
        setPhase('partial');
        setError(cause instanceof Error ? cause.message : 'Could not compose the locked background.');
      }
    })();
  }, [assets, refresh, service, target]);

  useEffect(() => {
    const expected = target;
    if (!expected) return;
    const backgroundReady = assets.some((asset) => asset.kind === 'background' && asset.status === 'ready');
    if (!backgroundReady) return;
    let cancelled = false;
    void (async () => {
      try {
        const currentFingerprint = await mapPlanFingerprint(plan);
        if (cancelled || currentFingerprint !== expected.planFingerprint || !generationTargetMatches(targetRef.current, expected)) return;
        const records = await service.listAssets(expected.revisionId);
        if (cancelled || !generationTargetMatches(targetRef.current, expected)) return;
        const next = materializeMapSceneV2(plan, scene, expected, records);
        if (next && canonical(next) !== canonical(scene)) onSceneMaterialized(next);
      } catch (cause) {
        if (!cancelled && generationTargetMatches(targetRef.current, expected)) {
          setError(cause instanceof Error ? cause.message : 'Could not materialize the generated map Scene.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [assets, onSceneMaterialized, plan, scene, service, target]);

  const retry = useCallback(async (assetId: string) => {
    const expected = targetRef.current;
    const asset = assets.find((candidate) => candidate.id === assetId);
    if (!expected || !asset) return;
    setError(null);
    try {
      await service.invokePixelLab({
        operation: generationRetryOperation(asset),
        projectId: expected.projectId,
        mapId: expected.mapId,
        revisionId: expected.revisionId,
        generationId: expected.generationId,
        assetId,
      });
      await refresh(expected);
    } catch (cause) {
      if (generationTargetMatches(targetRef.current, expected)) {
        setError(cause instanceof Error ? cause.message : 'Could not retry this resource.');
      }
    }
  }, [assets, refresh, service]);

  useMapGenerationMonitoring({ watch, target, service, refresh, setError, submissionActive });

  const reset = useCallback(() => {
    lifecycleEpoch.current += 1;
    targetRef.current = null;
    setTarget(null);
    setGenerationPlan(plan);
    setAssets(buildMapAssetPlansV2(plan).map(previewAsset));
    setPhase('idle');
    setError(null);
    compositionLock.current = '';
  }, [plan]);

  const readyCount = assets.filter((asset) => asset.status === 'ready').length;
  const failedCount = assets.filter((asset) => asset.status === 'failed' || asset.status === 'blocked').length;
  const byKind = useCallback((kind: MapAssetKindV2) => assets.filter((asset) => asset.kind === kind), [assets]);

  return {
    assets,
    phase,
    target,
    error,
    readyCount,
    failedCount,
    totalCount: assets.length,
    canPrepare,
    prepare,
    prepareRestore,
    installRestore,
    confirm,
    retry,
    byKind,
    reset,
  };
}
