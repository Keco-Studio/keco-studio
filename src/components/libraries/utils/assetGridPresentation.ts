export const ASSET_GRID_SIZES = [
  { tileWidth: 56, metadataLimit: 0, label: '10%', layout: 'list' },
  { tileWidth: 72, metadataLimit: 0, label: '25%', layout: 'grid' },
  { tileWidth: 88, metadataLimit: 0, label: '40%', layout: 'grid' },
  { tileWidth: 112, metadataLimit: 0, label: '60%', layout: 'grid' },
  { tileWidth: 144, metadataLimit: 0, label: '75%', layout: 'grid' },
  { tileWidth: 184, metadataLimit: 1, label: '100%', layout: 'grid' },
  { tileWidth: 232, metadataLimit: 2, label: '125%', layout: 'grid' },
  { tileWidth: 288, metadataLimit: 3, label: '150%', layout: 'grid' },
] as const;

export type AssetGridSizeIndex = number;
export const DEFAULT_ASSET_GRID_SIZE_INDEX = 5;

export function isAssetGridListMode(sizeIndex: AssetGridSizeIndex): boolean {
  const boundedIndex = Math.min(ASSET_GRID_SIZES.length - 1, Math.max(0, sizeIndex));
  return ASSET_GRID_SIZES[boundedIndex]?.layout === 'list';
}

export function getAdminAssetTargetRowHeight(sizeIndex: AssetGridSizeIndex): number {
  const boundedIndex = Math.min(ASSET_GRID_SIZES.length - 1, Math.max(0, sizeIndex));
  if (isAssetGridListMode(boundedIndex)) return 64;
  return [72, 96, 120, 144, 168, 192, 216][boundedIndex - 1] ?? 168;
}

export function nextAssetGridSize(
  currentIndex: AssetGridSizeIndex,
  deltaY: number,
): AssetGridSizeIndex {
  if (deltaY === 0) return currentIndex;
  const direction = deltaY < 0 ? 1 : -1;
  return Math.min(ASSET_GRID_SIZES.length - 1, Math.max(0, currentIndex + direction));
}
