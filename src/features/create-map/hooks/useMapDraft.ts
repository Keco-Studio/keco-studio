'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';
import type { MapPlan } from '../model/mapPlanSchema';
import type { MapScene } from '../model/mapSceneSchema';
import {
  CreateMapServiceError,
  createMapService,
  type MapDraftIdentity,
  type MapSourceToken,
} from '../services/createMapService';

export type MapSaveStatus = 'idle' | 'creating' | 'saved' | 'saving' | 'conflict' | 'error';

export function useMapDraft(plan: MapPlan, scene: MapScene) {
  const supabase = useSupabase();
  const service = useMemo(() => createMapService(supabase), [supabase]);
  const [identity, setIdentity] = useState<MapDraftIdentity | null>(null);
  const [status, setStatus] = useState<MapSaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const lastSaved = useRef('');
  const currentPayload = JSON.stringify({ plan, scene });
  const autosaveFrozen = status === 'conflict';
  const isDirty = Boolean(identity) && currentPayload !== lastSaved.current;

  const create = useCallback(async (
    projectId: string,
    source: MapSourceToken,
    nextPlan: MapPlan = plan,
    nextScene: MapScene = scene
  ) => {
    setStatus('creating');
    setError(null);
    try {
      const next = await service.createProject(projectId, nextPlan, nextScene, source);
      lastSaved.current = JSON.stringify({ plan: nextPlan, scene: nextScene });
      setIdentity(next);
      setStatus('saved');
      return next;
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not create map draft');
      throw cause;
    }
  }, [plan, scene, service]);

  useEffect(() => {
    if (!identity || autosaveFrozen || currentPayload === lastSaved.current) return;
    const timer = window.setTimeout(async () => {
      setStatus('saving');
      try {
        const saveVersion = await service.saveDraft(identity, plan, scene);
        lastSaved.current = currentPayload;
        setIdentity((current) => current ? { ...current, saveVersion } : current);
        setStatus('saved');
        setError(null);
      } catch (cause) {
        if (cause instanceof CreateMapServiceError && cause.code === 'save_conflict') {
          setStatus('conflict');
          setError('This draft changed elsewhere. Reload it or save these edits as a new revision.');
        } else {
          setStatus('error');
          setError(cause instanceof Error ? cause.message : 'Autosave failed');
        }
      }
    }, 750);
    return () => window.clearTimeout(timer);
  }, [autosaveFrozen, currentPayload, identity, plan, scene, service]);

  const reload = useCallback(async () => {
    if (!identity) return null;
    const loaded = await service.loadCurrentDraft(identity.mapId);
    lastSaved.current = JSON.stringify({ plan: loaded.plan, scene: loaded.scene });
    setIdentity(loaded.identity);
    setStatus('saved');
    setError(null);
    return loaded;
  }, [identity, service]);

  const install = useCallback((loaded: { identity: MapDraftIdentity; plan: MapPlan; scene: MapScene }) => {
    lastSaved.current = JSON.stringify({ plan: loaded.plan, scene: loaded.scene });
    setIdentity(loaded.identity);
    setStatus('saved');
    setError(null);
  }, []);

  const saveAsNewRevision = useCallback(async () => {
    if (!identity) return null;
    const next = await service.forkDraft(identity, plan, scene);
    lastSaved.current = currentPayload;
    setIdentity(next);
    setStatus('saved');
    setError(null);
    return next;
  }, [currentPayload, identity, plan, scene, service]);

  const publishForGeneration = useCallback(async () => {
    if (!identity) throw new CreateMapServiceError('missing_draft', 'Create and save a map plan first.');
    if (currentPayload !== lastSaved.current || status !== 'saved') {
      throw new CreateMapServiceError('draft_not_saved', 'Wait for the current map draft to finish saving.');
    }
    const published = await service.publish(identity);
    if (published.status !== 'published') throw new CreateMapServiceError('publish_conflict', 'The map draft changed before generation.');
    const next = await service.loadCurrentDraft(identity.mapId);
    lastSaved.current = JSON.stringify({ plan: next.plan, scene: next.scene });
    setIdentity(next.identity);
    setStatus('saved');
    setError(null);
    return { mapId: identity.mapId, publishedRevisionId: published.published_revision_id, nextDraft: next };
  }, [currentPayload, identity, service, status]);

  return { identity, status, error, isDirty, create, reload, install, saveAsNewRevision, publishForGeneration };
}
