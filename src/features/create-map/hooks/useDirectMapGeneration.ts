'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';
import {
  validateMapPlanV3,
  validateMapSceneV3,
  type MapPlanV3,
  type MapSceneV3,
} from '../model/directMapSchema';
import {
  createMapService,
  type MapAssetRecord,
  type SavedMapWorkspaceV3,
} from '../services/createMapService';

export type DirectMapGenerationPhase =
  | 'idle'
  | 'preparing'
  | 'awaiting-confirmation'
  | 'submitting'
  | 'generating'
  | 'validating'
  | 'ready'
  | 'failed'
  | 'blocked';

export type DirectMapGenerationAsset = {
  id: string;
  status: MapAssetRecord['status'];
  lastErrorCode: string | null;
  providerOperation: string | null;
  providerJobId: string | null;
  generationId: string;
  planFingerprint: string;
  storagePath: string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  hasTransparency: boolean | null;
  signedUrl: string | null;
};

export type DirectMapGenerationTarget = {
  projectId: string;
  mapId: string;
  revisionId: string;
  generationId: string;
  planFingerprint: string;
};

export type PreparedDirectMapRestore = {
  target: DirectMapGenerationTarget | null;
  plan: MapPlanV3;
  scene: MapSceneV3;
  asset: DirectMapGenerationAsset | null;
  phase: DirectMapGenerationPhase;
};

export const RETRYABLE_DIRECT_MAP_BLOCKS = new Set([
  'pixellab_rate_limited',
  'pixellab_quota_exceeded',
  'pixellab_upstream',
]);

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

type DirectMapInputSnapshot = {
  projectId: string;
  planKey: string;
  sceneKey: string;
};

function sameInputSnapshot(left: DirectMapInputSnapshot, right: DirectMapInputSnapshot): boolean {
  return left.projectId === right.projectId
    && left.planKey === right.planKey
    && left.sceneKey === right.sceneKey;
}

export async function directMapPlanFingerprint(plan: MapPlanV3): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(plan)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function expectedGenerationParams(plan: MapPlanV3): Record<string, unknown> {
  return {
    width: plan.map.width,
    height: plan.map.height,
    noBackground: false,
    seed: plan.generation.seed,
    references: plan.references,
    styleReference: plan.styleReference,
  };
}

function directMapAssetFromRecord(
  record: MapAssetRecord,
  plan: MapPlanV3,
  target: DirectMapGenerationTarget,
  signedUrl: string | null = null,
): DirectMapGenerationAsset {
  if (
    record.map_revision_id !== target.revisionId
    || record.asset_key !== 'map-image'
    || record.kind !== 'map_image'
    || record.requested_capability !== 'direct_map_image'
    || record.prompt !== plan.description
    || canonical(record.generation_params) !== canonical(expectedGenerationParams(plan))
    || record.generation_id !== target.generationId
    || record.plan_fingerprint !== target.planFingerprint
  ) {
    throw new Error('Direct map asset plan does not match its generation identity.');
  }
  if (
    (record.status === 'generating' || record.status === 'ready')
    && (record.provider_operation !== 'create_image_pro' || !record.provider_job_id)
  ) {
    throw new Error('Direct map provider identity is invalid.');
  }
  return {
    id: record.id,
    status: record.status,
    lastErrorCode: record.last_error_code,
    providerOperation: record.provider_operation ?? null,
    providerJobId: record.provider_job_id ?? null,
    generationId: target.generationId,
    planFingerprint: target.planFingerprint,
    storagePath: record.storage_path,
    sha256: record.sha256,
    width: record.width,
    height: record.height,
    hasTransparency: record.has_transparency,
    signedUrl,
  };
}

export function directMapPhaseFor(asset: DirectMapGenerationAsset | null): DirectMapGenerationPhase {
  if (!asset) return 'idle';
  if (asset.status === 'planned') return 'awaiting-confirmation';
  if (asset.status === 'queued' || asset.status === 'generating') return 'generating';
  if (asset.status === 'ready') return 'ready';
  if (asset.status === 'blocked') return 'blocked';
  return 'failed';
}

export function canRetryDirectMap(asset: DirectMapGenerationAsset | null): boolean {
  if (!asset) return false;
  if (asset.status === 'failed') return true;
  return asset.status === 'blocked'
    && asset.lastErrorCode !== null
    && RETRYABLE_DIRECT_MAP_BLOCKS.has(asset.lastErrorCode);
}

export function directMapTargetMatches(
  left: DirectMapGenerationTarget | null,
  right: DirectMapGenerationTarget,
): boolean {
  return Boolean(left
    && left.projectId === right.projectId
    && left.mapId === right.mapId
    && left.revisionId === right.revisionId
    && left.generationId === right.generationId
    && left.planFingerprint === right.planFingerprint);
}

export function materializeDirectMapScene(
  plan: MapPlanV3,
  current: MapSceneV3,
  target: DirectMapGenerationTarget,
  asset: DirectMapGenerationAsset,
): MapSceneV3 | null {
  if (
    asset.status !== 'ready'
    || asset.generationId !== target.generationId
    || asset.planFingerprint !== target.planFingerprint
    || asset.providerOperation !== 'create_image_pro'
    || !asset.providerJobId
    || typeof asset.storagePath !== 'string'
    || asset.storagePath.length === 0
    || typeof asset.sha256 !== 'string'
    || !SHA256_PATTERN.test(asset.sha256)
    || asset.width !== plan.map.width
    || asset.height !== plan.map.height
    || asset.hasTransparency !== false
  ) return null;

  const next: MapSceneV3 = {
    ...current,
    size: { ...plan.map },
    mapImage: {
      assetKey: 'map-image',
      sourceRevisionId: target.revisionId,
      width: plan.map.width,
      height: plan.map.height,
      locked: true,
    },
  };
  return validateMapSceneV3(plan, next).success ? next : null;
}

export async function prepareDirectMapRestore(
  workspace: SavedMapWorkspaceV3,
  createSignedUrl: (storagePath: string) => Promise<string>,
): Promise<PreparedDirectMapRestore> {
  if (!workspace.imageAsset || !workspace.assetRevisionId) {
    if (workspace.scene.mapImage) throw new Error('Saved direct map image is missing.');
    return { target: null, plan: workspace.plan, scene: workspace.scene, asset: null, phase: 'idle' };
  }
  const generationId = workspace.imageAsset.generation_id;
  const planFingerprint = await directMapPlanFingerprint(workspace.plan);
  if (
    !generationId
    || workspace.imageAsset.plan_fingerprint !== planFingerprint
    || workspace.imageAsset.map_revision_id !== workspace.assetRevisionId
  ) {
    throw new Error('Saved direct map generation identity is invalid.');
  }
  const target: DirectMapGenerationTarget = {
    projectId: workspace.projectId,
    mapId: workspace.identity.mapId,
    revisionId: workspace.assetRevisionId,
    generationId,
    planFingerprint,
  };
  const durableAsset = directMapAssetFromRecord(workspace.imageAsset, workspace.plan, target);
  let signedUrl = workspace.imageUrl;
  if (!signedUrl && durableAsset.status === 'ready' && durableAsset.storagePath) {
    try {
      signedUrl = await createSignedUrl(durableAsset.storagePath);
    } catch {
      signedUrl = null;
    }
  }
  const asset = { ...durableAsset, signedUrl };
  return { target, plan: workspace.plan, scene: workspace.scene, asset, phase: directMapPhaseFor(asset) };
}

type DirectMapMonitoringService = {
  invokePixelLab(input: Record<string, unknown>): Promise<unknown>;
};

function responseStatus(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const status = (value as { status?: unknown }).status;
  return typeof status === 'string' ? status : null;
}

export function useDirectMapGenerationMonitoring({
  asset,
  target,
  service,
  refresh,
  setPhase,
  setError,
}: {
  asset: DirectMapGenerationAsset | null;
  target: DirectMapGenerationTarget | null;
  service: DirectMapMonitoringService;
  refresh: (target: DirectMapGenerationTarget) => Promise<void>;
  setPhase: (phase: DirectMapGenerationPhase) => void;
  setError: (error: string | null) => void;
}): void {
  const cycleRef = useRef(0);
  const pollActive = useRef<string | null>(null);
  const currentTarget = useRef(target);
  const currentAsset = useRef(asset);
  currentTarget.current = target;
  currentAsset.current = asset;
  const targetKey = target
    ? `${target.projectId}:${target.mapId}:${target.revisionId}:${target.generationId}:${target.planFingerprint}`
    : '';
  const assetKey = asset ? `${asset.id}:${asset.status}` : '';

  useEffect(() => {
    const cycle = ++cycleRef.current;
    const expectedTarget = currentTarget.current;
    const expectedAsset = currentAsset.current;
    if (!expectedTarget || !expectedAsset || expectedAsset.status !== 'generating') return;
    const requestKey = `${targetKey}:${expectedAsset.id}`;
    const poll = async () => {
      if (pollActive.current === requestKey) return;
      pollActive.current = requestKey;
      try {
        const body = {
          projectId: expectedTarget.projectId,
          mapId: expectedTarget.mapId,
          revisionId: expectedTarget.revisionId,
          generationId: expectedTarget.generationId,
          assetId: expectedAsset.id,
        };
        const result = await service.invokePixelLab({ operation: 'poll', ...body });
        if (cycleRef.current !== cycle) return;
        if (responseStatus(result) === 'completed') {
          setPhase('validating');
          await service.invokePixelLab({ operation: 'validate', ...body });
          if (cycleRef.current !== cycle) return;
        }
        await refresh(expectedTarget);
      } catch (cause) {
        if (cycleRef.current === cycle) {
          setError(cause instanceof Error ? cause.message : 'Could not refresh direct map generation.');
          try {
            await refresh(expectedTarget);
          } catch {
            // Preserve the provider error when the durable state refresh also fails.
          }
        }
      } finally {
        if (pollActive.current === requestKey) pollActive.current = null;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2500);
    return () => {
      clearInterval(timer);
      if (cycleRef.current === cycle) cycleRef.current += 1;
    };
  }, [assetKey, refresh, service, setError, setPhase, targetKey]);
}

type UseDirectMapGenerationInput = {
  projectId: string;
  plan: MapPlanV3;
  scene: MapSceneV3;
  canPrepare: boolean;
  publishForGeneration: () => Promise<{ mapId: string; publishedRevisionId: string }>;
  onSceneMaterialized: (scene: MapSceneV3) => void;
};

export function useDirectMapGeneration({
  projectId,
  plan,
  scene,
  canPrepare,
  publishForGeneration,
  onSceneMaterialized,
}: UseDirectMapGenerationInput) {
  const supabase = useSupabase();
  const service = useMemo(() => createMapService(supabase), [supabase]);
  const [generationPlan, setGenerationPlan] = useState(plan);
  const [asset, setAsset] = useState<DirectMapGenerationAsset | null>(null);
  const [phase, setPhase] = useState<DirectMapGenerationPhase>('idle');
  const [target, setTarget] = useState<DirectMapGenerationTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const targetRef = useRef<DirectMapGenerationTarget | null>(null);
  const lifecycleEpoch = useRef(0);
  const submissionActive = useRef(false);
  const preparationActive = useRef(false);
  const currentInput = useRef({ projectId, planKey: canonical(plan), sceneKey: canonical(scene), scene });
  currentInput.current = { projectId, planKey: canonical(plan), sceneKey: canonical(scene), scene };
  targetRef.current = target;

  const refresh = useCallback(async (expected: DirectMapGenerationTarget) => {
    const records = await service.listAssets(expected.revisionId);
    if (!directMapTargetMatches(targetRef.current, expected)) return;
    const matches = records.filter((record) => record.kind === 'map_image' && record.asset_key === 'map-image');
    if (matches.length !== 1) throw new Error('Expected exactly one direct map image.');
    let next = directMapAssetFromRecord(matches[0], generationPlan, expected);
    if (next.status === 'ready' && next.storagePath) {
      try {
        next = { ...next, signedUrl: await service.createSignedAssetUrl(next.storagePath) };
      } catch {
        // The durable ready asset remains usable after a temporary signing failure.
      }
    }
    if (!directMapTargetMatches(targetRef.current, expected)) return;
    setAsset(next);
    setPhase(directMapPhaseFor(next));
    if (next.status === 'ready') {
      const latest = currentInput.current;
      if (latest.projectId !== expected.projectId || latest.planKey !== canonical(generationPlan)) return;
      const materialized = materializeDirectMapScene(generationPlan, latest.scene, expected, next);
      if (materialized && canonical(materialized) !== latest.sceneKey) onSceneMaterialized(materialized);
    }
  }, [generationPlan, onSceneMaterialized, service]);

  const startPreparation = useCallback(async () => {
    if (preparationActive.current) return;
    const validation = validateMapPlanV3(plan);
    if (validation.success === false) {
      setError('Resolve the direct map Plan issues before preparing generation.');
      return;
    }
    if (!projectId || !canPrepare) {
      setError('Wait for the current map draft to finish saving.');
      return;
    }
    preparationActive.current = true;
    const expectedInput: DirectMapInputSnapshot = { ...currentInput.current };
    const epoch = ++lifecycleEpoch.current;
    setPhase('preparing');
    setError(null);
    try {
      const published = await publishForGeneration();
      const generationId = crypto.randomUUID();
      const planFingerprint = await directMapPlanFingerprint(validation.data);
      const nextTarget: DirectMapGenerationTarget = {
        projectId,
        mapId: published.mapId,
        revisionId: published.publishedRevisionId,
        generationId,
        planFingerprint,
      };
      const created = await service.createAssetPlanV3(nextTarget.revisionId, generationId, planFingerprint);
      const record = await service.readAssetPlan(created.asset_id);
      const nextAsset = directMapAssetFromRecord(record, validation.data, nextTarget);
      if (lifecycleEpoch.current !== epoch
        || !sameInputSnapshot(currentInput.current, expectedInput)) {
        if (lifecycleEpoch.current === epoch && !targetRef.current) setPhase('idle');
        return;
      }
      targetRef.current = nextTarget;
      setTarget(nextTarget);
      setGenerationPlan(validation.data);
      setAsset(nextAsset);
      setPhase(directMapPhaseFor(nextAsset));
    } catch (cause) {
      if (lifecycleEpoch.current !== epoch) return;
      if (sameInputSnapshot(currentInput.current, expectedInput)) {
        setPhase('failed');
        setError(cause instanceof Error ? cause.message : 'Could not prepare direct map generation.');
      } else if (!targetRef.current) {
        setPhase('idle');
      }
    } finally {
      preparationActive.current = false;
    }
  }, [canPrepare, plan, projectId, publishForGeneration, service]);

  const confirm = useCallback(async () => {
    const expected = targetRef.current;
    if (!expected || !asset || asset.status !== 'planned' || submissionActive.current) return;
    const expectedInput: DirectMapInputSnapshot = { ...currentInput.current };
    submissionActive.current = true;
    setPhase('submitting');
    setError(null);
    try {
      await service.invokePixelLab({
        operation: 'submit',
        projectId: expected.projectId,
        mapId: expected.mapId,
        revisionId: expected.revisionId,
        generationId: expected.generationId,
        assetId: asset.id,
      });
      await refresh(expected);
    } catch (cause) {
      if (directMapTargetMatches(targetRef.current, expected)
        && sameInputSnapshot(currentInput.current, expectedInput)) {
        setError(cause instanceof Error ? cause.message : 'Could not submit direct map generation.');
      }
      try { await refresh(expected); } catch {
        if (directMapTargetMatches(targetRef.current, expected)
          && sameInputSnapshot(currentInput.current, expectedInput)) setPhase('failed');
      }
    } finally {
      submissionActive.current = false;
    }
  }, [asset, refresh, service]);

  const retry = useCallback(async () => {
    const expected = targetRef.current;
    if (!expected || !canRetryDirectMap(asset) || submissionActive.current || !asset) return;
    const expectedInput: DirectMapInputSnapshot = { ...currentInput.current };
    submissionActive.current = true;
    setPhase('submitting');
    setError(null);
    try {
      await service.invokePixelLab({
        operation: 'retry',
        projectId: expected.projectId,
        mapId: expected.mapId,
        revisionId: expected.revisionId,
        generationId: expected.generationId,
        assetId: asset.id,
      });
      await refresh(expected);
    } catch (cause) {
      if (directMapTargetMatches(targetRef.current, expected)
        && sameInputSnapshot(currentInput.current, expectedInput)) {
        setError(cause instanceof Error ? cause.message : 'Could not retry direct map generation.');
      }
      try { await refresh(expected); } catch {
        if (directMapTargetMatches(targetRef.current, expected)
          && sameInputSnapshot(currentInput.current, expectedInput)) setPhase(directMapPhaseFor(asset));
      }
    } finally {
      submissionActive.current = false;
    }
  }, [asset, refresh, service]);

  const prepareRestore = useCallback(
    (workspace: SavedMapWorkspaceV3) => prepareDirectMapRestore(workspace, service.createSignedAssetUrl),
    [service],
  );

  const installRestore = useCallback((prepared: PreparedDirectMapRestore) => {
    lifecycleEpoch.current += 1;
    targetRef.current = prepared.target;
    setTarget(prepared.target);
    setGenerationPlan(prepared.plan);
    setAsset(prepared.asset);
    setPhase(prepared.phase);
    setError(null);
  }, []);

  useDirectMapGenerationMonitoring({ asset, target, service, refresh, setPhase, setError });

  const reset = useCallback(() => {
    lifecycleEpoch.current += 1;
    targetRef.current = null;
    setTarget(null);
    setGenerationPlan(plan);
    setAsset(null);
    setPhase('idle');
    setError(null);
  }, [plan]);

  return {
    asset,
    phase,
    target,
    error,
    canPrepare,
    canRetry: canRetryDirectMap(asset),
    prepare: startPreparation,
    confirm,
    retry,
    regenerate: startPreparation,
    prepareRestore,
    installRestore,
    reset,
  };
}
