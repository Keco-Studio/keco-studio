/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, jest } from '@jest/globals';
import { useState } from 'react';
import { useDirectMapCollisionGrid } from '@/features/create-map/hooks/useDirectMapCollisionGrid';
import { createEmptyCollisionGrid } from '@/features/create-map/model/directMapCollisionGrid';
import { makeEmptyMapSceneV3 } from './fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

describe('Direct Map collision history cancellation', () => {
  it('discards an analysis that settles while a historical Map selection is open', async () => {
    const first = deferred<ReturnType<typeof createEmptyCollisionGrid>>();
    const second = deferred<ReturnType<typeof createEmptyCollisionGrid>>();
    const analyzeCollisionGrid = jest.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const revisionId = '10000000-0000-4000-8000-000000000001';
    const image = {
      sourceRevisionId: revisionId,
      sha256: 'a'.repeat(64),
      signedUrl: 'https://example.test/map.png',
      width: 512,
      height: 512,
    };
    const initialScene = {
      ...makeEmptyMapSceneV3(),
      mapImage: { assetKey: 'map-image' as const, sourceRevisionId: revisionId, width: 512, height: 512, locked: true },
    };

    const { result, rerender } = renderHook(({ canAnalyze }) => {
      const [scene, setScene] = useState(initialScene);
      const collision = useDirectMapCollisionGrid({
        projectId: 'project-1',
        identity: { mapId: 'map-1', revisionId, revisionNumber: 1, saveVersion: 1 },
        canAnalyze,
        scene,
        image,
        service: { analyzeCollisionGrid },
        setScene,
      });
      return { scene, collision };
    }, { initialProps: { canAnalyze: true } });

    await waitFor(() => expect(analyzeCollisionGrid).toHaveBeenCalledTimes(1));
    rerender({ canAnalyze: false });

    await act(async () => {
      first.resolve(createEmptyCollisionGrid(512, 512, image.sha256));
      await Promise.resolve();
    });

    expect(result.current.scene.collisionGrid).toBeNull();
    expect(result.current.collision.phase).toBe('idle');

    rerender({ canAnalyze: true });
    await waitFor(() => expect(analyzeCollisionGrid).toHaveBeenCalledTimes(2));
  });
});
