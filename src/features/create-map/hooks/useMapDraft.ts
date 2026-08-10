'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';
import { validateMapPlanV2, type MapPlanV2 } from '../model/mapPlanSchema';
import { validateMapSceneV2, type MapSceneV2 } from '../model/mapSceneSchema';
import {
  CreateMapServiceError,
  createMapService,
  type MapDraftIdentity,
  type MapSourceToken,
  type SavedMapWorkspaceV2,
} from '../services/createMapService';

export type MapSaveStatus = 'idle' | 'creating' | 'saved' | 'saving' | 'conflict' | 'error';

export type MapDraftPayloadV2 = { plan: MapPlanV2; scene: MapSceneV2 };

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

type SerializedDraftWriterCallbacks = {
  onSaving?: () => void;
  onSaved?: (identity: MapDraftIdentity, payload: MapDraftPayloadV2) => void;
  onConflict?: (error: unknown) => void;
  onError?: (error: unknown) => void;
};

type PendingSave = {
  epoch: number;
  payload: MapDraftPayloadV2;
};

function sameIdentity(left: MapDraftIdentity, right: MapDraftIdentity): boolean {
  return left.mapId === right.mapId && left.revisionId === right.revisionId;
}

export class SerializedMapDraftWriter {
  private epoch = 0;
  private identity: MapDraftIdentity | null = null;
  private pending: PendingSave | null = null;
  private running: Promise<void> | null = null;
  private frozen = false;

  constructor(
    private readonly save: (identity: MapDraftIdentity, payload: MapDraftPayloadV2) => Promise<number>,
    private readonly callbacks: SerializedDraftWriterCallbacks = {},
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

  enqueue(payload: MapDraftPayloadV2): Promise<void> {
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

function payloadKey(payload: MapDraftPayloadV2): string {
  return JSON.stringify(payload);
}

export function useMapDraft(plan: MapPlanV2, scene: MapSceneV2) {
  const supabase = useSupabase();
  const service = useMemo(() => createMapService(supabase), [supabase]);
  const [identity, setIdentity] = useState<MapDraftIdentity | null>(null);
  const [status, setStatus] = useState<MapSaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState('');
  const writer = useMemo(() => new SerializedMapDraftWriter(
    (target, payload) => service.saveDraftV2(target, payload.plan, payload.scene),
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
  ), [service]);
  const currentPayload = useMemo(() => ({ plan, scene }), [plan, scene]);
  const currentPayloadKey = payloadKey(currentPayload);
  const isDirty = Boolean(identity) && currentPayloadKey !== lastSaved;
  const currentValidation = useMemo(() => validateMapDraftPayloadV2(plan, scene), [plan, scene]);
  const localValidationError = identity && isDirty && currentValidation.success === false
    ? 'Resolve the current Plan or Scene validation issues before saving.'
    : null;
  const effectiveStatus: MapSaveStatus = status === 'conflict' ? status : localValidationError ? 'error' : status;

  useEffect(() => () => {
    writer.install(null);
  }, [writer]);

  useEffect(() => {
    if (!identity || writer.isFrozen() || currentPayloadKey === lastSaved) return;
    if (currentValidation.success === false) return;
    const delay = writer.isRunning() ? 0 : 750;
    const timer = window.setTimeout(() => void writer.enqueue(currentPayload), delay);
    return () => window.clearTimeout(timer);
  }, [currentPayload, currentPayloadKey, currentValidation.success, identity, lastSaved, writer]);

  const create = useCallback(async (
    projectId: string,
    source: MapSourceToken | null,
    nextPlan: MapPlanV2 = plan,
    nextScene: MapSceneV2 = scene,
  ) => {
    const validation = validateMapDraftPayloadV2(nextPlan, nextScene);
    if (validation.success === false) {
      throw new CreateMapServiceError('invalid_map', 'Resolve the Plan or Scene validation issues before saving.');
    }
    setStatus('creating');
    setError(null);
    const requestEpoch = writer.currentEpoch();
    try {
      const next = await service.createProjectV2(projectId, validation.payload.plan, validation.payload.scene, source);
      if (writer.currentEpoch() !== requestEpoch) return next;
      writer.install(next);
      setLastSaved(payloadKey(validation.payload));
      setIdentity(next);
      setStatus('saved');
      return next;
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not create map draft');
      throw cause;
    }
  }, [plan, scene, service, writer]);

  const install = useCallback((loaded: Pick<SavedMapWorkspaceV2, 'identity' | 'plan' | 'scene'>) => {
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
    const loaded = await service.loadSavedMapV2(target.mapId);
    if (writer.currentEpoch() !== requestEpoch) return null;
    install(loaded);
    return loaded;
  }, [install, service, writer]);

  const reset = useCallback(() => {
    writer.install(null);
    setLastSaved('');
    setIdentity(null);
    setStatus('idle');
    setError(null);
  }, [writer]);

  const saveNow = useCallback(async () => {
    if (!writer.currentIdentity()) return;
    const validation = validateMapDraftPayloadV2(plan, scene);
    if (validation.success === false) {
      setStatus('error');
      setError('Resolve the current Plan or Scene validation issues before saving.');
      return;
    }
    await writer.enqueue(validation.payload);
  }, [plan, scene, writer]);

  const publishForGeneration = useCallback(async () => {
    const target = writer.currentIdentity();
    if (!target) throw new CreateMapServiceError('missing_draft', 'Create and save a map plan first.');
    if (currentPayloadKey !== lastSaved || status !== 'saved' || writer.isRunning()) {
      throw new CreateMapServiceError('draft_not_saved', 'Wait for the current map draft to finish saving.');
    }
    const requestEpoch = writer.currentEpoch();
    const published = await service.publishV2(target);
    const nextDraft = await service.loadSavedMapV2(target.mapId);
    if (writer.currentEpoch() !== requestEpoch) {
      return {
        mapId: target.mapId,
        publishedRevisionId: published.published_revision_id,
        nextDraft,
      };
    }
    install(nextDraft);
    return {
      mapId: target.mapId,
      publishedRevisionId: published.published_revision_id,
      nextDraft,
    };
  }, [currentPayloadKey, install, lastSaved, service, status, writer]);

  return {
    identity,
    status: effectiveStatus,
    error: localValidationError ?? error,
    isValid: currentValidation.success,
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
