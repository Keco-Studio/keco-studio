import { useCallback, useMemo } from 'react';

type ViewportSize = {
  width: number;
  height: number;
};

/** Ported from battle-poc `useMapRenderMetrics` — grid cell → screen px. */
export function useMapRenderMetrics({
  viewportSize,
  mapWidth,
  mapHeight,
  fit = 'contain',
}: {
  viewportSize: ViewportSize;
  mapWidth: number;
  mapHeight: number;
  /** contain = letterbox; cover = fill viewport (may crop edges) */
  fit?: 'contain' | 'cover';
}) {
  const mapAspect = mapWidth / Math.max(1, mapHeight);
  const viewAspect = viewportSize.width / Math.max(1, viewportSize.height);

  let renderWidth: number;
  let renderHeight: number;

  if (fit === 'cover') {
    if (viewAspect > mapAspect) {
      renderWidth = Math.floor(viewportSize.width);
      renderHeight = Math.floor(viewportSize.width / mapAspect);
    } else {
      renderHeight = Math.floor(viewportSize.height);
      renderWidth = Math.floor(viewportSize.height * mapAspect);
    }
  } else if (viewAspect > mapAspect) {
    renderWidth = Math.floor(viewportSize.height * mapAspect);
    renderHeight = Math.floor(viewportSize.height);
  } else {
    renderWidth = Math.floor(viewportSize.width);
    renderHeight = Math.floor(viewportSize.width / mapAspect);
  }

  const renderOffsetX = Math.floor((viewportSize.width - renderWidth) / 2);
  const renderOffsetY = Math.floor((viewportSize.height - renderHeight) / 2);

  const mapCellDisplayPx = useMemo(
    () => Math.min(renderWidth / Math.max(1, mapWidth), renderHeight / Math.max(1, mapHeight)) * 0.92,
    [mapHeight, mapWidth, renderHeight, renderWidth],
  );

  const actorPx = useMemo(() => Math.max(32, Math.round(mapCellDisplayPx * 1.5)), [mapCellDisplayPx]);

  const gridToScreen = useCallback(
    (x: number, y: number) => ({
      x: renderOffsetX + ((x + 0.5) / mapWidth) * renderWidth,
      y: renderOffsetY + ((y + 0.5) / mapHeight) * renderHeight,
    }),
    [mapHeight, mapWidth, renderHeight, renderOffsetX, renderOffsetY, renderWidth],
  );

  return {
    renderWidth,
    renderHeight,
    renderOffsetX,
    renderOffsetY,
    mapCellDisplayPx,
    actorPx,
    gridToScreen,
  };
}
