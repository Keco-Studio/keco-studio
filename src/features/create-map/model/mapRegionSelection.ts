export type MapRegionSelection = { x: number; y: number; width: number; height: number };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampMapRegionSelection(
  selection: MapRegionSelection,
  map: { width: number; height: number },
): MapRegionSelection {
  const x = clamp(Math.round(selection.x), 0, map.width);
  const y = clamp(Math.round(selection.y), 0, map.height);
  const right = clamp(Math.round(selection.x + selection.width), 0, map.width);
  const bottom = clamp(Math.round(selection.y + selection.height), 0, map.height);
  return {
    x: Math.min(x, right),
    y: Math.min(y, bottom),
    width: Math.abs(right - x),
    height: Math.abs(bottom - y),
  };
}
