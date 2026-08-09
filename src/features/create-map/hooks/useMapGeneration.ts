'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';
import { buildMapAssetPlans, type MapAssetKind, type MapAssetPlanRow } from '../model/mapAssetPlan';
import { validateMapPlan, type MapPlan } from '../model/mapPlanSchema';
import { createMapService, type MapAssetRecord } from '../services/createMapService';
import { submitMapAssetsInBatches } from '../services/mapGenerationQueue';

export type MapGenerationPhase =
  | 'idle'
  | 'preparing'
  | 'awaiting-confirmation'
  | 'submitting'
  | 'generating'
  | 'partial'
  | 'ready'
  | 'failed';

export type MapGenerationAssetStatus = MapAssetRecord['status'] | 'unplanned';

export type MapGenerationAsset = MapAssetPlanRow & {
  id: string | null;
  status: MapGenerationAssetStatus;
  attemptCount: number;
  errorCode: string | null;
  storagePath: string | null;
  signedUrl: string | null;
};

type PlannedGenerationAsset = MapGenerationAsset & { id: string; status: 'planned' };

export type PublishedTarget = { mapId: string; revisionId: string };

export type PreparedGenerationRestore = {
  target: PublishedTarget | null;
  assets: MapGenerationAsset[];
  phase: MapGenerationPhase;
};

type UseMapGenerationInput = {
  projectId: string;
  plan: MapPlan;
  canPrepare: boolean;
  publishForGeneration: () => Promise<{ mapId: string; publishedRevisionId: string }>;
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

function previewAsset(row: MapAssetPlanRow): MapGenerationAsset {
  return { ...row, id: null, status: 'unplanned', attemptCount: 0, errorCode: null, storagePath: null, signedUrl: null };
}

function verifiedAsset(row: MapAssetPlanRow, record: MapAssetRecord): MapGenerationAsset {
  const matches = record.asset_key === row.assetKey
    && record.kind === row.kind
    && record.prompt === row.prompt
    && record.requested_capability === row.requestedCapability
    && canonical(record.generation_params) === canonical(row.generationParams)
    && canonical(record.metadata) === canonical(row.metadata);
  if (!matches) throw new Error(`Asset plan read-back mismatch: ${row.assetKey}`);
  return {
    ...row,
    id: record.id,
    status: record.status,
    attemptCount: record.attempt_count,
    errorCode: record.last_error_code,
    storagePath: record.storage_path,
    signedUrl: null,
  };
}

function phaseFor(assets: MapGenerationAsset[]): MapGenerationPhase {
  if (assets.length > 0 && assets.every((asset) => asset.status === 'ready')) return 'ready';
  const hasPlanned = assets.some((asset) => asset.status === 'planned');
  const hasActive = assets.some((asset) => asset.status === 'queued' || asset.status === 'generating');
  if (hasPlanned && !hasActive) return 'awaiting-confirmation';
  const hasFailure = assets.some((asset) => asset.status === 'failed' || asset.status === 'blocked');
  const hasReady = assets.some((asset) => asset.status === 'ready');
  if (hasFailure && hasReady) return 'partial';
  if (hasFailure && assets.every((asset) => ['ready', 'failed', 'blocked'].includes(asset.status))) return 'failed';
  return 'generating';
}

export function plannedAssetsForSubmission(assets: MapGenerationAsset[]): PlannedGenerationAsset[] {
  return assets.filter((asset): asset is PlannedGenerationAsset => asset.status === 'planned' && asset.id !== null);
}

export function generationWatchPlan(assets: MapGenerationAsset[]): { active: boolean; pollAssetIds: string[]; key: string } {
  const watchedAssets = assets.flatMap((asset) =>
    asset.status === 'queued' || asset.status === 'generating'
      ? [[asset.status, asset.id] as const]
      : []
  ).sort(([leftStatus, leftId], [rightStatus, rightId]) =>
    leftStatus.localeCompare(rightStatus) || (leftId ?? '').localeCompare(rightId ?? '')
  );
  return {
    active: watchedAssets.length > 0,
    pollAssetIds: assets.flatMap((asset) => asset.status === 'generating' && asset.id ? [asset.id] : []),
    key: JSON.stringify(watchedAssets),
  };
}

export async function prepareGenerationRestore(
  input: { mapId: string; revisionId: string | null; plan: MapPlan; records: MapAssetRecord[] },
  createSignedUrl: (storagePath: string) => Promise<string>
): Promise<PreparedGenerationRestore> {
  const rows = buildMapAssetPlans(input.plan);
  if (!input.revisionId || input.records.length === 0) {
    return { target: null, assets: rows.map(previewAsset), phase: 'idle' };
  }
  const byKey = new Map(input.records.map((record) => [record.asset_key, record]));
  let restoredRows: MapGenerationAsset[];
  try {
    restoredRows = rows.map((row) => {
      const record = byKey.get(row.assetKey);
      if (!record) throw new Error(`Missing persisted asset: ${row.assetKey}`);
      return verifiedAsset(row, record);
    });
  } catch {
    return { target: null, assets: rows.map(previewAsset), phase: 'idle' };
  }
  const assets = await Promise.all(restoredRows.map(async (restored) => {
    const record = byKey.get(restored.assetKey) as MapAssetRecord;
    if (record.status !== 'ready' || !record.storage_path) return restored;
    try {
      return { ...restored, signedUrl: await createSignedUrl(record.storage_path) };
    } catch {
      return restored;
    }
  }));
  return {
    target: { mapId: input.mapId, revisionId: input.revisionId },
    assets,
    phase: phaseFor(assets),
  };
}

export function useMapGeneration({ projectId, plan, canPrepare, publishForGeneration }: UseMapGenerationInput) {
  const supabase = useSupabase();
  const service = useMemo(() => createMapService(supabase), [supabase]);
  const planRows = useMemo(() => buildMapAssetPlans(plan), [plan]);
  const [assets, setAssets] = useState<MapGenerationAsset[]>(() => planRows.map(previewAsset));
  const [phase, setPhase] = useState<MapGenerationPhase>('idle');
  const [target, setTarget] = useState<PublishedTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollActive = useRef(false);
  const submissionActive = useRef(false);
  const watch = generationWatchPlan(assets);
  const watchRef = useRef(watch);
  watchRef.current = watch;

  useEffect(() => {
    if (phase === 'idle') setAssets(planRows.map(previewAsset));
  }, [phase, planRows]);

  const applyRecord = useCallback(async (record: MapAssetRecord) => {
    let signedUrl: string | null = null;
    if (record.status === 'ready' && record.storage_path) {
      try { signedUrl = await service.createSignedAssetUrl(record.storage_path); } catch { signedUrl = null; }
    }
    setAssets((current) => current.map((asset) => asset.id === record.id ? {
      ...asset,
      status: record.status,
      attemptCount: record.attempt_count,
      errorCode: record.last_error_code,
      storagePath: record.storage_path,
      signedUrl: signedUrl ?? asset.signedUrl,
    } : asset));
  }, [service]);

  const refresh = useCallback(async (revisionId: string) => {
    const records = await service.listAssets(revisionId);
    await Promise.all(records.map(applyRecord));
    setAssets((current) => {
      const byId = new Map(records.map((record) => [record.id, record]));
      const next = current.map((asset) => {
        const record = asset.id ? byId.get(asset.id) : undefined;
        return record ? { ...asset, status: record.status, attemptCount: record.attempt_count, errorCode: record.last_error_code, storagePath: record.storage_path } : asset;
      });
      setPhase(phaseFor(next));
      return next;
    });
  }, [applyRecord, service]);

  const prepareRestore = useCallback(
    (input: Parameters<typeof prepareGenerationRestore>[0]) =>
      prepareGenerationRestore(input, service.createSignedAssetUrl),
    [service]
  );

  const installRestore = useCallback((prepared: PreparedGenerationRestore) => {
    setTarget(prepared.target);
    setAssets(prepared.assets);
    setPhase(prepared.phase);
    setError(null);
  }, []);

  const prepare = useCallback(async () => {
    const validation = validateMapPlan(plan);
    if (!validation.success) {
      setError('Resolve the map plan issues before preparing PixelLab resources.');
      return;
    }
    if (!projectId || !canPrepare) {
      setError('Wait for the current map draft to finish saving.');
      return;
    }
    setPhase('preparing');
    setError(null);
    try {
      const published = await publishForGeneration();
      const nextTarget = { mapId: published.mapId, revisionId: published.publishedRevisionId };
      const rows = buildMapAssetPlans(validation.data);
      const planned = await Promise.all(rows.map(async (row) => {
        const created = await service.createAssetPlan({
          p_revision_id: published.publishedRevisionId,
          p_asset_key: row.assetKey,
          p_kind: row.kind,
          p_prompt: row.prompt,
          p_requested_capability: row.requestedCapability,
          p_generation_params: row.generationParams,
          p_reference_asset_ids: [],
          p_reference_hashes: [],
          p_metadata: row.metadata,
        });
        const readBack = await service.readAssetPlan(created.asset_id);
        return verifiedAsset(row, readBack);
      }));
      setTarget(nextTarget);
      setAssets(planned);
      setPhase('awaiting-confirmation');
    } catch (cause) {
      setPhase('failed');
      setError(cause instanceof Error ? cause.message : 'Could not prepare map resources.');
    }
  }, [canPrepare, plan, projectId, publishForGeneration, service]);

  const confirm = useCallback(async () => {
    const plannedAssets = plannedAssetsForSubmission(assets);
    if (!target || phase !== 'awaiting-confirmation' || plannedAssets.length === 0) return;
    setPhase('submitting');
    setError(null);
    submissionActive.current = true;
    try {
      await submitMapAssetsInBatches(
        plannedAssets,
        async (asset) => {
          await service.invokePixelLab({
            operation: 'submit',
            projectId,
            mapId: target.mapId,
            revisionId: target.revisionId,
            assetId: asset.id,
          });
        },
        async (batch, batchResults) => {
          const failedIds = new Set(batchResults.flatMap((result, index) =>
            result.status === 'rejected' && batch[index].id ? [batch[index].id as string] : []
          ));
          const successfulIds = new Set(batchResults.flatMap((result, index) =>
            result.status === 'fulfilled' && batch[index].id ? [batch[index].id as string] : []
          ));
          setAssets((current) => current.map((asset) =>
            failedIds.has(asset.id ?? '')
              ? { ...asset, status: 'failed', errorCode: 'submit_failed' }
              : successfulIds.has(asset.id ?? '')
                ? { ...asset, status: 'generating', errorCode: null }
                : asset
          ));
          setPhase('generating');

          for (let cycle = 0; successfulIds.size > 0 && cycle < 120; cycle += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 2500));
            await Promise.allSettled([...successfulIds].map((assetId) =>
              service.invokePixelLab({ operation: 'poll', projectId, assetId })
            ));
            const records = await service.listAssets(target.revisionId);
            await Promise.all(records.map(applyRecord));
            const pendingIds = new Set(records
              .filter((record) => successfulIds.has(record.id) && record.status === 'generating')
              .map((record) => record.id));
            successfulIds.forEach((assetId) => {
              if (!pendingIds.has(assetId)) successfulIds.delete(assetId);
            });
          }
          if (successfulIds.size > 0) throw new Error('PixelLab generation batch timed out.');
        },
        4
      );
      await refresh(target.revisionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not generate map resources.');
      try { await refresh(target.revisionId); } catch { setPhase('failed'); }
    } finally {
      submissionActive.current = false;
    }
  }, [applyRecord, assets, phase, projectId, refresh, service, target]);

  const retry = useCallback(async (assetId: string) => {
    if (!target) return;
    setError(null);
    try {
      await service.invokePixelLab({ operation: 'retry', projectId, assetId });
      setAssets((current) => current.map((asset) => asset.id === assetId ? { ...asset, status: 'generating', errorCode: null } : asset));
      setPhase('generating');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not retry this resource.');
    }
  }, [projectId, service, target]);

  useEffect(() => {
    if (!target || !watch.active) return;
    const poll = async () => {
      if (submissionActive.current || pollActive.current) return;
      pollActive.current = true;
      try {
        const latestWatch = watchRef.current;
        await Promise.allSettled(latestWatch.pollAssetIds.map((assetId) =>
          service.invokePixelLab({ operation: 'poll', projectId, assetId })
        ));
        await refresh(target.revisionId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not refresh PixelLab progress.');
      } finally {
        pollActive.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => window.clearInterval(timer);
  }, [projectId, refresh, service, target, watch.active, watch.key]);

  const readyCount = assets.filter((asset) => asset.status === 'ready').length;
  const failedCount = assets.filter((asset) => asset.status === 'failed' || asset.status === 'blocked').length;
  const byKind = useCallback((kind: MapAssetKind) => assets.filter((asset) => asset.kind === kind), [assets]);

  const reset = useCallback(() => {
    setTarget(null);
    setError(null);
    setPhase('idle');
    setAssets(planRows.map(previewAsset));
  }, [planRows]);

  return {
    assets, phase, error, readyCount, failedCount, totalCount: assets.length, canPrepare,
    prepare, prepareRestore, installRestore, confirm, retry, byKind, reset,
  };
}
