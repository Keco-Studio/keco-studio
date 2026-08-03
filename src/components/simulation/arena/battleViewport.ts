export type BattleCanvasMetrics = {
  width: number;
  height: number;
  pixelRatio: number;
  backingWidth: number;
  backingHeight: number;
};

export function battleActorSize(mapCellDisplayPx: number): number {
  return Math.max(1, Math.round(mapCellDisplayPx * 1.5));
}

export function battleGridToScreen(input: {
  x: number;
  y: number;
  mapWidth: number;
  mapHeight: number;
  renderWidth: number;
  renderHeight: number;
  renderOffsetX: number;
  renderOffsetY: number;
}) {
  return {
    x: input.renderOffsetX + (input.x / input.mapWidth) * input.renderWidth,
    y: input.renderOffsetY + (input.y / input.mapHeight) * input.renderHeight,
  };
}

export function battleActorPercentPosition(input: {
  x: number;
  y: number;
  mapWidth: number;
  mapHeight: number;
  actorCells: number;
}) {
  const radiusX = (input.actorCells / 2 / input.mapWidth) * 100;
  const radiusY = (input.actorCells / 2 / input.mapHeight) * 100;
  const left = Math.max(radiusX, Math.min(100 - radiusX, (input.x / input.mapWidth) * 100));
  const top = Math.max(radiusY, Math.min(100 - radiusY, (input.y / input.mapHeight) * 100));
  return { left: `${left}%`, top: `${top}%` };
}

export function battleCanvasMetrics(
  rect: { width: number; height: number },
  devicePixelRatio: number
): BattleCanvasMetrics | null {
  if (rect.width < 2 || rect.height < 2) return null;

  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const finiteRatio = Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  const pixelRatio = Math.round(Math.min(3, Math.max(0.5, finiteRatio)) * 100) / 100;

  return {
    width,
    height,
    pixelRatio,
    backingWidth: Math.max(1, Math.round(width * pixelRatio)),
    backingHeight: Math.max(1, Math.round(height * pixelRatio)),
  };
}
