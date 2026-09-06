import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  claimGddMapArtifact,
  finishGddMapArtifact,
  heartbeatGddMapArtifact,
  prepareGddMapArtifact,
  reconcileGddMapArtifact,
  rescheduleGddMapArtifact,
  type GddMapArtifact,
  type GddMapArtifactPhase,
  type GddMapArtifactStatus,
} from '@/lib/services/gddGenerationService';
import { gddMapBriefSchema, type GddMapBrief } from './contracts';
import { fingerprintMapPlanV3, mapPlanFromGddBrief, mapSceneFromGddBrief } from './plan';

type MapWorkerInput = { serviceClient: SupabaseClient; workerId: string; artifact: GddMapArtifact };

type MapWorkerDependencies = {
  claim: typeof claimGddMapArtifact;
  prepare: typeof prepareGddMapArtifact;
  reschedule: typeof rescheduleGddMapArtifact;
  finish: typeof finishGddMapArtifact;
  heartbeat?: typeof heartbeatGddMapArtifact;
  reconcile?: typeof reconcileGddMapArtifact;
  invoke: typeof invokePixelLabMap;
};

const MAP_PROVIDER_DEADLINE_MS = 90_000;
const MAP_PROVIDER_MAX_WAIT_MS = 15 * 60_000;

export class GddMapProviderError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'GddMapProviderError';
    this.code = code;
    this.status = status;
  }
}

function serviceRoleToken(): string {
  const token = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured for the GDD map worker.');
  return token;
}

function pixelLabMapUrl(): string {
  const explicit = process.env.PIXELLAB_MAP_FUNCTION_URL;
  if (explicit) return explicit;
  const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('SUPABASE_URL is not configured for the GDD map worker.');
  return `${base}/functions/v1/pixellab-map`;
}

export async function invokePixelLabMap(input: {
  operation: 'submit' | 'retry' | 'poll' | 'validate';
  projectId: string;
  assetId: string;
  mapId: string;
  revisionId: string;
  generationId: string;
  gddMapArtifactId: string;
  actorUserId: string;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const { signal, ...payload } = input;
  const response = await fetch(pixelLabMapUrl(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serviceRoleToken()}`,
      apikey: serviceRoleToken(),
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal,
  });
  const body = await response.json().catch(() => ({})) as unknown;
  const record = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  if (!response.ok) {
    const code = typeof record.code === 'string' ? record.code : 'pixellab_upstream';
    const message = typeof record.error === 'string' ? record.error : `PixelLab map request failed (${response.status}).`;
    throw new GddMapProviderError(code, message, response.status);
  }
  return record;
}

function briefForArtifact(artifact: GddMapArtifact): GddMapBrief {
  return gddMapBriefSchema.parse(artifact.map_brief);
}

function actorId(artifact: GddMapArtifact): string {
  // owner_id is intentionally not in the public DTO but is present on the
  // service-role claim row. Keep the worker tolerant of old fixtures.
  const value = (artifact as GddMapArtifact & { owner_id?: unknown }).owner_id;
  if (typeof value !== 'string') throw new Error('GDD map artifact owner is missing.');
  return value;
}

function providerInput(artifact: GddMapArtifact): Parameters<typeof invokePixelLabMap>[0] {
  if (!artifact.map_project_id || !artifact.map_revision_id || !artifact.map_asset_id
    || !(artifact as GddMapArtifact & { generation_id?: unknown }).generation_id) {
    throw new Error('GDD map artifact is missing its prepared map identities.');
  }
  return {
    operation: artifact.phase === 'submitting'
      ? (artifact.attempt_count ?? 0) > 0 ? 'retry' : 'submit'
      : artifact.phase === 'polling' ? 'poll' : 'validate',
    projectId: artifact.project_id,
    assetId: artifact.map_asset_id,
    mapId: artifact.map_project_id,
    revisionId: artifact.map_revision_id,
    generationId: String((artifact as GddMapArtifact & { generation_id: unknown }).generation_id),
    gddMapArtifactId: artifact.id,
    actorUserId: actorId(artifact),
  };
}

async function invokeWithLeaseHeartbeat(
  input: MapWorkerInput,
  dependencies: MapWorkerDependencies,
  operation: (signal: AbortSignal) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort(new Error('PixelLab map provider deadline exceeded.'));
  }, MAP_PROVIDER_DEADLINE_MS);
  let heartbeatFailure: unknown;
  let pendingHeartbeat = Promise.resolve();
  const timer = setInterval(() => {
    if (!dependencies.heartbeat || heartbeatFailure) return;
    pendingHeartbeat = pendingHeartbeat
      .then(() => dependencies.heartbeat!(input.serviceClient, {
        artifactId: input.artifact.id,
        workerId: input.workerId,
        phase: input.artifact.phase,
        leaseSeconds: 300,
      }))
      .catch((error) => { heartbeatFailure = error; });
  }, 30_000);
  try {
    const operationPromise = operation(controller.signal);
    const result = await Promise.race([
      operationPromise,
      new Promise<Record<string, unknown>>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new GddMapProviderError('pixellab_timeout', 'PixelLab map provider deadline exceeded.', 504));
        }, { once: true });
      }),
    ]);
    await Promise.race([
      pendingHeartbeat,
      new Promise<void>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(controller.signal.reason ?? new Error('PixelLab map provider was aborted.'));
        }, { once: true });
      }),
    ]);
    if (heartbeatFailure) throw heartbeatFailure;
    return result;
  } finally {
    clearInterval(timer);
    clearTimeout(deadline);
  }
}

async function processClaimedGddMapArtifact(
  input: MapWorkerInput,
  dependencies: MapWorkerDependencies,
): Promise<GddMapArtifactStatus> {
  const { serviceClient, workerId, artifact } = input;
  if (artifact.phase === 'planning') {
    const brief = briefForArtifact(artifact);
    const plan = mapPlanFromGddBrief(brief);
    const scene = mapSceneFromGddBrief(brief);
    await dependencies.prepare(serviceClient, {
      artifactId: artifact.id,
      workerId,
      plan,
      scene,
      generationId: randomUUID(),
      planFingerprint: fingerprintMapPlanV3(plan),
    });
    return 'queued';
  }

  if (artifact.phase === 'submitting' && dependencies.reconcile) {
    const reconciled = await dependencies.reconcile(serviceClient, artifact.id);
    if (reconciled === 'queued' || reconciled === 'ready' || reconciled === 'blocked') return reconciled;
  }

  const operation = providerInput(artifact);
  const response = await invokeWithLeaseHeartbeat(input, dependencies, (signal) => dependencies.invoke({ ...operation, signal }));
  const status = typeof response.status === 'string' ? response.status : null;
  if (artifact.phase === 'submitting') {
    if (status !== 'generating') throw new GddMapProviderError('pixellab_invalid_response', 'PixelLab did not start the map job.', 502);
    await dependencies.reschedule(serviceClient, { artifactId: artifact.id, workerId, phase: 'polling', delaySeconds: 0 });
    return 'queued';
  }
  if (artifact.phase === 'polling') {
    if (status === 'completed') {
      await dependencies.reschedule(serviceClient, { artifactId: artifact.id, workerId, phase: 'validating', delaySeconds: 0 });
      return 'queued';
    }
    if (status === 'failed') {
      await dependencies.finish(serviceClient, { artifactId: artifact.id, workerId, status: 'failed', error: 'PixelLab map generation failed.' });
      return 'failed';
    }
    const startedAt = Date.parse(artifact.started_at ?? '');
    if (Number.isFinite(startedAt) && Date.now() - startedAt >= MAP_PROVIDER_MAX_WAIT_MS) {
      await dependencies.finish(serviceClient, {
        artifactId: artifact.id,
        workerId,
        status: 'failed',
        error: 'PixelLab map generation exceeded the 15 minute time limit.',
      });
      return 'failed';
    }
    await dependencies.reschedule(serviceClient, { artifactId: artifact.id, workerId, phase: 'polling', delaySeconds: 15 });
    return 'queued';
  }
  if (status !== 'ready') throw new GddMapProviderError('pixellab_invalid_response', 'PixelLab map validation did not produce a ready asset.', 502);
  await dependencies.finish(serviceClient, { artifactId: artifact.id, workerId, status: 'ready' });
  return 'ready';
}

const defaultDependencies: MapWorkerDependencies = {
  claim: claimGddMapArtifact,
  prepare: prepareGddMapArtifact,
  reschedule: rescheduleGddMapArtifact,
  finish: finishGddMapArtifact,
  heartbeat: heartbeatGddMapArtifact,
  reconcile: reconcileGddMapArtifact,
  invoke: invokePixelLabMap,
};

export async function processClaimedGddMapArtifactWithDependencies(
  input: MapWorkerInput,
  dependencies: MapWorkerDependencies = defaultDependencies,
): Promise<GddMapArtifactStatus> {
  const { serviceClient, workerId, artifact } = input;
  try {
    return await processClaimedGddMapArtifact(input, dependencies);
  } catch (error) {
    const message = (
      error instanceof Error && error.message
        ? error.message
        : error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : 'GDD map generation failed.'
    ).slice(0, 1000);
    const code = error instanceof GddMapProviderError
      ? error.code
      : error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : '';
    // A provider submission or validation may persist durable progress before
    // its response times out. Reconcile before recording a terminal failure.
    if ((artifact.phase === 'submitting' || artifact.phase === 'validating') && dependencies.reconcile) {
      try {
        const reconciled = await dependencies.reconcile(serviceClient, artifact.id);
        if (reconciled === 'queued' || reconciled === 'ready' || reconciled === 'blocked') return reconciled;
      } catch {
        // Preserve the original provider error when no durable progress exists.
      }
    }
    const retryableSubmission = artifact.phase === 'submitting' && (
      code === 'pixellab_rate_limited'
      || code === 'pixellab_quota_exceeded'
      || (error instanceof GddMapProviderError && error.status >= 500
        && code !== 'pixellab_invalid_response' && code !== 'pixellab_timeout')
    );
    if (retryableSubmission) {
      if ((artifact.attempt_count ?? 0) + 1 >= (artifact.max_attempts ?? 3)) {
        await dependencies.finish(serviceClient, { artifactId: artifact.id, workerId, status: 'failed', error: message });
        return 'failed';
      }
      return (await dependencies.reschedule(serviceClient, { artifactId: artifact.id, workerId, phase: 'submitting', delaySeconds: 30, error: message })) ?? 'failed';
    }
    if (artifact.phase === 'submitting') {
      await dependencies.finish(serviceClient, { artifactId: artifact.id, workerId, status: 'blocked', error: message });
      return 'blocked';
    }
    if (artifact.phase === 'polling' && error instanceof GddMapProviderError && error.status >= 500) {
      if ((artifact.attempt_count ?? 0) + 1 >= (artifact.max_attempts ?? 3)) {
        await dependencies.finish(serviceClient, { artifactId: artifact.id, workerId, status: 'failed', error: message });
        return 'failed';
      }
      return (await dependencies.reschedule(serviceClient, { artifactId: artifact.id, workerId, phase: 'polling', delaySeconds: 20, error: message })) ?? 'failed';
    }
    await dependencies.finish(serviceClient, { artifactId: artifact.id, workerId, status: 'failed', error: message });
    return 'failed';
  }
}

export async function processNextGddMapArtifact(input: {
  serviceClient: SupabaseClient;
  workerId: string;
}): Promise<{ claimed: boolean; artifactId?: string; status?: GddMapArtifactStatus }> {
  if (typeof (input.serviceClient as unknown as { rpc?: unknown }).rpc !== 'function') return { claimed: false };
  const artifact = await claimGddMapArtifact(input.serviceClient, input.workerId);
  if (!artifact) return { claimed: false };
  const status = await processClaimedGddMapArtifactWithDependencies({ ...input, artifact });
  return { claimed: true, artifactId: artifact.id, status };
}

export type { MapWorkerDependencies };
