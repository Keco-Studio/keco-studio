import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { cellDisplayString } from '@/lib/utils/assetEmptiness';

export const ASSET_GRID_SIZES = [
  { tileWidth: 112, metadataLimit: 0, label: '60%' },
  { tileWidth: 144, metadataLimit: 0, label: '75%' },
  { tileWidth: 184, metadataLimit: 1, label: '100%' },
  { tileWidth: 232, metadataLimit: 2, label: '125%' },
  { tileWidth: 288, metadataLimit: 3, label: '150%' },
] as const;

export type AssetGridSizeIndex = number;

type VirtualAssetRow = {
  index: number;
  start: number;
  end: number;
};

export function getVisibleAssetIndexRange({
  virtualRows,
  scrollOffset,
  viewportHeight,
  contentPadding,
  columnCount,
  assetCount,
}: {
  virtualRows: VirtualAssetRow[];
  scrollOffset: number;
  viewportHeight: number;
  contentPadding: number;
  columnCount: number;
  assetCount: number;
}): { firstIndex: number; lastIndex: number } {
  const viewportEnd = scrollOffset + viewportHeight;
  const visibleRows = virtualRows.filter((row) => (
    row.end + contentPadding > scrollOffset && row.start + contentPadding < viewportEnd
  ));
  const firstVisibleRow = visibleRows[0] ?? virtualRows[0];
  const lastVisibleRow = visibleRows[visibleRows.length - 1] ?? virtualRows[virtualRows.length - 1];

  return {
    firstIndex: firstVisibleRow ? firstVisibleRow.index * columnCount : 0,
    lastIndex: lastVisibleRow
      ? Math.min(assetCount - 1, (lastVisibleRow.index + 1) * columnCount - 1)
      : -1,
  };
}

export function nextAssetGridSize(
  currentIndex: AssetGridSizeIndex,
  deltaY: number,
): AssetGridSizeIndex {
  if (deltaY === 0) return currentIndex;
  const direction = deltaY < 0 ? 1 : -1;
  return Math.min(ASSET_GRID_SIZES.length - 1, Math.max(0, currentIndex + direction));
}

export function getVisibleAssetFocusIndex(
  currentIndex: number,
  firstVisibleIndex: number,
  lastVisibleIndex: number,
): number {
  if (lastVisibleIndex < firstVisibleIndex) return currentIndex;
  return currentIndex < firstVisibleIndex || currentIndex > lastVisibleIndex
    ? firstVisibleIndex
    : currentIndex;
}

type MediaValue = {
  url?: unknown;
  fileType?: unknown;
};

function parseMediaValue(raw: unknown): MediaValue | null {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as MediaValue) : null;
    } catch {
      return null;
    }
  }
  return raw && typeof raw === 'object' ? (raw as MediaValue) : null;
}

function isSafeImageUrl(value: string): boolean {
  if (value.startsWith('data:image/') || value.startsWith('blob:')) return true;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function getAssetGridPreviewUrl(
  row: AssetRow,
  properties: PropertyConfig[],
): string | null {
  const imageProperties = properties
    .filter((property) => property.dataType === 'image')
    .sort((left, right) => left.orderIndex - right.orderIndex);

  for (const property of imageProperties) {
    const media = parseMediaValue(row.propertyValues[property.key]);
    if (!media || typeof media.url !== 'string' || typeof media.fileType !== 'string') continue;
    if (!media.fileType.startsWith('image/') || !isSafeImageUrl(media.url)) continue;
    return media.url;
  }

  return null;
}

export type AssetGridMetadata = { label: string; value: string };

export function getAssetGridMetadata(
  row: AssetRow,
  properties: PropertyConfig[],
  limit: number,
): AssetGridMetadata[] {
  if (limit <= 0) return [];

  const metadata: AssetGridMetadata[] = [];
  const orderedProperties = [...properties].sort(
    (left, right) => left.orderIndex - right.orderIndex,
  );

  for (const property of orderedProperties) {
    if (property.dataType === 'image') continue;
    const value = cellDisplayString(row.propertyValues[property.key]);
    if (!value) continue;
    metadata.push({ label: property.name, value });
    if (metadata.length === limit) break;
  }

  return metadata;
}
