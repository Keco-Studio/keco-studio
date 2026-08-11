'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';
import { validateMapPlanV3, validateMapSceneV3, type MapPlanV3, type MapSceneV3 } from '../model/directMapSchema';
import { validateMapPlanV2, type MapPlanV2 } from '../model/mapPlanSchema';
import { validateMapSceneV2, type MapSceneV2 } from '../model/mapSceneSchema';
import {
  CreateMapServiceError,
  createMapService,
  type MapDraftIdentity,
  type MapSourceToken,
  type SavedMapWorkspaceV2,
  type SavedMapWorkspaceV3,
} from '../services/createMapService';

export type MapSaveStatus = 'idle' | 'creating' | 'saved' | 'saving' | 'conflict' | 'error';

export type MapDraftPayloadV2 = { plan: MapPlanV2; scene: MapSceneV2 };
export type MapDraftPayloadV3 = { plan: MapPlanV3; scene: MapSceneV3 };
export type MapDraftPayload<P, S> = { plan: P; scene: S };

export function validateMapDraftPayloadV2(
  plan: MapPlanV2,
  scene: MapSceneV2,
): { success: true; payload: MapDraftPayloadV2 } | { success: false } {
  const planValidation = validateMapPlanV2(plan);
  if (planValidation.success === false) return { success: false };
  const sceneValidation = validateMapSceneV2(planValidation.data, scene);
  return sceneValidation.success
    ? { success: true, payload: { plan: planValidation.data, scene: sceneValidation.data } }
    : { success: false };
}

export function validateMapDraftPayloadV3(
  plan: MapPlanV3,
  scene: MapSceneV3,
): { success: true; payload: MapDraftPayloadV3 } | { success: false } {
  const planValidation = validateMapPlanV3(plan);
  if (planValidation.success === false) return { success: false };
  const sceneValidation = validateMapSceneV3(planValidation.data, scene);
  return sceneValidation.success
    ? { success: true, payload: { plan: planValidation.data, scene: sceneValidation.data } }
    : { success: false };
}

type SerializedDraftWriterCallbacks<TPayload> = {
  onSaving?: () => void;
  onSaved?: (identity: MapDraftIdentity, payload: TPayload) => void;
  onConflict?: (error: unknown) => void;
  onError?: (error: unknown) => void;
};

type PendingSave<TPayload> = {
  epoch: number;
  payload: TPayload;
};

function sameIdentity(left: MapDraftIdentity, right: MapDraftIdentity): boolean {
  return left.mapId === right.mapId && left.revisionId === right.revisionId;
}

export class SerializedMapDraftWriter<TPayload = MapDraftPayloadV2> {
  private epoch = 0;
  private identity: MapDraftIdentity | null = null;
  private pending: PendingSave<TPayload> | null = null;
  private running: Promise<void> | null = null;
  private frozen = false;

  constructor(
    private readonly save: (identity: MapDraftIdentity, payload: TPayload) => Promise<number>,
    private readonly callbacks: SerializedDraftWriterCallbacks<TPayload> = {},
  ) {}

  install(identity: MapDraftIdentity | null): number {
    this.epoch += 1;
    this.identity = identity;
    this.pending = null;
    this.frozen = false;
    return this.epoch;
  }

  currentEpoch(): number {
    return this.epoch;
  }

  currentIdentity(): MapDraftIdentity | null {
    return this.identity;
  }

  isRunning(): boolean {
    return this.running !== null;
  }

  isFrozen(): boolean {
    return this.frozen;
  }

  enqueue(payload: TPayload): Promise<void> {
    if (!this.identity || this.frozen) return Promise.resolve();
    this.pending = { epoch: this.epoch, payload };
    if (!this.running) {
      this.running = this.drain().finally(() => {
        this.running = null;
        if (this.pending && !this.frozen) void this.enqueue(this.pending.payload);
      });
    }
    return this.running;
  }

  private async drain(): Promise<void> {
    while (this.pending && !this.frozen) {
      const pending = this.pending;
      this.pending = null;
      const target = this.identity;
      if (!target || pending.epoch !== this.epoch) continue;
      this.callbacks.onSaving?.();
      try {
        const saveVersion = await this.save(target, pending.payload);
        if (pending.epoch !== this.epoch || !this.identity || !sameIdentity(target, this.identity)) continue;
        this.identity = { ...this.identity, saveVersion };
        this.callbacks.onSaved?.(this.identity, pending.payload);
      } catch (error) {
        if (pending.epoch !== this.epoch || !this.identity || !sameIdentity(target, this.identity)) continue;
        if (error instanceof CreateMapServiceError && error.code === 'save_conflict') {
          this.frozen = true;
          this.callbacks.onConflict?.(error);
        } else {
          this.callbacks.onError?.(error);
        }
      }
    }
  }
}

function payloadKey(payload: unknown): string {
  return JSON.stringify(payload);
}

type DraftWorkspace<P, S> = {
  identity: MapDraftIdentity;
  plan: P;
  scene: S;
};

export type MapDraftAdapter<P, S, W extends DraftWorkspace<P, S>> = {
  validate(plan: P, scene: S): boolean;
  create(projectId: string, source: MapSourceToken | null, plan: P, scene: S): Promise<MapDraftIdentity>;
  save(identity: MapDraftIdentity, plan: P, scene: S): Promise<number>;
  publish(identity: MapDraftIdentity): Promise<{ publishedRevisionId: string; nextDraftRevisionId: string }>;
  load(mapId: string): Promise<W>;
};

type MapService = ReturnType<typeof createMapService>;

export function createMapDraftAdapterV2(service: MapService): MapDraftAdapter<MapPlanV2, MapSceneV2, SavedMapWorkspaceV2> {
  return {
    validate: (plan, scene) => validateMapDraftPayloadV2(plan, scene).success,
    create: (projectId, source, plan, scene) => service.createProjectV2(projectId, plan, scene, source),
    save: (identity, plan, scene) => service.saveDraftV2(identity, plan, scene),
    publish: async (identity) => {
      const result = await service.publishV2(identity);
      return {
        publishedRevisionId: result.published_revision_id,
        nextDraftRevisionId: result.next_draft_revision_id,
      };
    },
    load: (mapId) => service.loadSavedMapV2(mapId),
  };
}

export function createMapDraftAdapterV3(service: MapService): MapDraftAdapter<MapPlanV3, MapSceneV3, SavedMapWorkspaceV3> {
  return {
    validate: (plan, scene) => validateMapDraftPayloadV3(plan, scene).success,
    create: (projectId, source, plan, scene) => service.createProjectV3(projectId, plan, scene, source),
    save: (identity, plan, scene) => service.saveDraftV3(identity, plan, scene),
    publish: async (identity) => {
      const result = await service.publishV3(identity);
      return {
        publishedRevisionId: result.published_revision_id,
        nextDraftRevisionId: result.next_draft_revision_id,
      };
    },
    load: (mapId) => service.loadSavedMapV3(mapId),
  };
}

export function useMapDraft<
  P = MapPlanV2,
  S = MapSceneV2,
  W extends DraftWorkspace<P, S> = DraftWorkspace<P, S>,
>(plan: P, scene: S, adapter?: MapDraftAdapter<P, S, W>) {
  const supabase = useSupabase();
  const service = useMemo(() => createMapService(supabase), [supabase]);
  const selectedAdapter = useMemo(
    () => adapter ?? createMapDraftAdapterV2(service) as unknown as MapDraftAdapter<P, S, W>,
    [adapter, service],
  );
  const [identity, setIdentity] = useState<MapDraftIdentity | null>(null);
  const [status, setStatus] = useState<MapSaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState('');
  const writer = useMemo(() => new SerializedMapDraftWriter<MapDraftPayload<P, S>>(
    (target, payload) => selectedAdapter.save(target, payload.plan, payload.scene),
    {
      onSaving: () => setStatus('saving'),
      onSaved: (nextIdentity, payload) => {
        setLastSaved(payloadKey(payload));
        setIdentity(nextIdentity);
        setStatus('saved');
        setError(null);
      },
      onConflict: () => {
        setStatus('conflict');
        setError('This draft changed elsewhere. Reload it before continuing.');
      },
      onError: (cause) => {
        setStatus('error');
        setError(cause instanceof Error ? cause.message : 'Autosave failed');
      },
    },
  ), [selectedAdapter]);
  const currentPayload = useMemo(() => ({ plan, scene }), [plan, scene]);
  const currentPayloadKey = payloadKey(currentPayload);
  const isDirty = Boolean(identity) && currentPayloadKey !== lastSaved;
  const currentValidation = useMemo(() => selectedAdapter.validate(plan, scene), [plan, scene, selectedAdapter]);
  const localValidationError = identity && isDirty && !currentValidation
    ? 'Resolve the current Plan or Scene validation issues before saving.'
    : null;
  const effectiveStatus: MapSaveStatus = status === 'conflict' ? status : localValidationError ? 'error' : status;

  useEffect(() => () => {
    writer.install(null);
  }, [writer]);

  useEffect(() => {
    if (!identity || writer.isFrozen() || currentPayloadKey === lastSaved) return;
    if (!currentValidation) return;
    const delay = writer.isRunning() ? 0 : 750;
    const timer = window.setTimeout(() => void writer.enqueue(currentPayload), delay);
    return () => window.clearTimeout(timer);
  }, [currentPayload, currentPayloadKey, currentValidation, identity, lastSaved, writer]);

  const create = useCallback(async (
    projectId: string,
    source: MapSourceToken | null,
    nextPlan: P = plan,
    nextScene: S = scene,
  ) => {
    if (!selectedAdapter.validate(nextPlan, nextScene)) {
      throw new CreateMapServiceError('invalid_map', 'Resolve the Plan or Scene validation issues before saving.');
    }
    setStatus('creating');
    setError(null);
    const requestEpoch = writer.currentEpoch();
    try {
      const next = await selectedAdapter.create(projectId, source, nextPlan, nextScene);
      if (writer.currentEpoch() !== requestEpoch) return next;
      writer.install(next);
      setLastSaved(payloadKey({ plan: nextPlan, scene: nextScene }));
      setIdentity(next);
      setStatus('saved');
      return next;
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not create map draft');
      throw cause;
    }
  }, [plan, scene, selectedAdapter, writer]);

  const install = useCallback((loaded: DraftWorkspace<P, S>) => {
    writer.install(loaded.identity);
    setLastSaved(payloadKey({ plan: loaded.plan, scene: loaded.scene }));
    setIdentity(loaded.identity);
    setStatus('saved');
    setError(null);
  }, [writer]);

  const reload = useCallback(async () => {
    const target = writer.currentIdentity();
    if (!target) return null;
    const requestEpoch = writer.currentEpoch();
    const loaded = await selectedAdapter.load(target.mapId);
    if (writer.currentEpoch() !== requestEpoch) return null;
    install(loaded);
    return loaded;
  }, [install, selectedAdapter, writer]);

  const reset = useCallback(() => {
    writer.install(null);
    setLastSaved('');
    setIdentity(null);
    setStatus('idle');
    setError(null);
  }, [writer]);

  const saveNow = useCallback(async () => {
    if (!writer.currentIdentity()) return;
    if (!selectedAdapter.validate(plan, scene)) {
      setStatus('error');
      setError('Resolve the current Plan or Scene validation issues before saving.');
      return;
    }
    await writer.enqueue({ plan, scene });
  }, [plan, scene, selectedAdapter, writer]);

  const publishForGeneration = useCallback(async () => {
    const target = writer.currentIdentity();
    if (!target) throw new CreateMapServiceError('missing_draft', 'Create and save a map plan first.');
    if (currentPayloadKey !== lastSaved || status !== 'saved' || writer.isRunning()) {
      throw new CreateMapServiceError('draft_not_saved', 'Wait for the current map draft to finish saving.');
    }
    const requestEpoch = writer.currentEpoch();
    const published = await selectedAdapter.publish(target);
    const nextDraft = await selectedAdapter.load(target.mapId);
    if (writer.currentEpoch() !== requestEpoch) {
      return {
        mapId: target.mapId,
        publishedRevisionId: published.publishedRevisionId,
        nextDraft,
      };
    }
    install(nextDraft);
    return {
      mapId: target.mapId,
      publishedRevisionId: published.publishedRevisionId,
      nextDraft,
    };
  }, [currentPayloadKey, install, lastSaved, selectedAdapter, status, writer]);

  return {
    identity,
    status: effectiveStatus,
    error: localValidationError ?? error,
    isValid: currentValidation,
    isDirty,
    installedEpoch: writer.currentEpoch(),
    create,
    install,
    reload,
    reset,
    saveNow,
    publishForGeneration,
  };
}
