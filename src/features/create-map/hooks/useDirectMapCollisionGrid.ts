'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collisionGridMatchesImage,
  createEmptyCollisionGrid,
  setCollisionCell,
  type DirectMapCollisionCell,
} from '../model/directMapCollisionGrid';
import type { MapDraftIdentity } from '../services/createMapService';
import type { MapSceneV3 } from '../model/directMapSchema';
import type { DirectMapCanvasImage } from '../components/DirectMapCanvas';

type CollisionService = {
  analyzeCollisionGrid(projectId: string, mapId: string, revisionId: string): Promise<MapSceneV3['collisionGrid']>;
};

export type DirectMapCollisionPhase = 'idle' | 'analyzing' | 'ready' | 'failed';

export function useDirectMapCollisionGrid({
  projectId,
  identity,
  canAnalyze,
  scene,
  image,
  service,
  setScene,
}: {
  projectId: string;
  identity: MapDraftIdentity | null;
  canAnalyze: boolean;
  scene: MapSceneV3;
  image: DirectMapCanvasImage | null;
  service: CollisionService;
  setScene: React.Dispatch<React.SetStateAction<MapSceneV3>>;
}) {
  const [phase, setPhase] = useState<DirectMapCollisionPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [paintMode, setPaintMode] = useState<DirectMapCollisionCell>(1);
  const attemptedKey = useRef<string | null>(null);
  const requestEpoch = useRef(0);
  const matches = collisionGridMatchesImage(scene.collisionGrid, image);
  const analysisKey = identity && image
    ? `${identity.mapId}:${identity.revisionId}:${image.sha256}`
    : null;
  const currentAnalysisKey = useRef(analysisKey);

  useEffect(() => {
    currentAnalysisKey.current = analysisKey;
  }, [analysisKey]);

  const analyze = useCallback(async (force = false) => {
    if (!projectId || !identity || !image || !analysisKey || !canAnalyze) return;
    if (!force && (matches || attemptedKey.current === analysisKey)) return;
    attemptedKey.current = analysisKey;
    const epoch = ++requestEpoch.current;
    setPhase('analyzing');
    setError(null);
    try {
      const collisionGrid = await service.analyzeCollisionGrid(
        projectId,
        identity.mapId,
        identity.revisionId,
      );
      if (requestEpoch.current !== epoch
        || currentAnalysisKey.current !== analysisKey
        || collisionGrid?.imageSha256 !== image.sha256) return;
      setScene((current) => ({ ...current, collisionGrid }));
      setOverlayVisible(true);
      setPhase('ready');
    } catch (cause) {
      if (requestEpoch.current !== epoch) return;
      setPhase('failed');
      setError(cause instanceof Error ? cause.message : 'Could not analyze map obstacles.');
    }
  }, [analysisKey, canAnalyze, identity, image, matches, projectId, service, setScene]);

  useEffect(() => {
    if (!analysisKey) {
      requestEpoch.current += 1;
      attemptedKey.current = null;
      return;
    }
    if (!canAnalyze) {
      return;
    }
    if (matches) {
      attemptedKey.current = analysisKey;
      return;
    }
    const timer = window.setTimeout(() => void analyze(), 0);
    return () => window.clearTimeout(timer);
  }, [analysisKey, analyze, canAnalyze, matches]);

  const paintCell = useCallback((column: number, row: number, value: DirectMapCollisionCell = paintMode) => {
    setScene((current) => current.collisionGrid
      ? { ...current, collisionGrid: setCollisionCell(current.collisionGrid, column, row, value) }
      : current);
  }, [paintMode, setScene]);

  const clearGrid = useCallback(() => {
    if (!image) return;
    setScene((current) => ({
      ...current,
      collisionGrid: createEmptyCollisionGrid(image.width, image.height, image.sha256),
    }));
    setPhase('ready');
  }, [image, setScene]);

  return {
    phase: !analysisKey ? 'idle' as const : matches ? 'ready' as const : phase,
    error: matches ? null : error,
    overlayVisible,
    paintMode,
    setOverlayVisible,
    setPaintMode,
    paintCell,
    clearGrid,
    retry: () => analyze(true),
  };
}
