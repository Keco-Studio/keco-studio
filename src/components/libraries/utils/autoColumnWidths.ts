import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

const MIN_COLUMN_WIDTH = 96;
const MAX_CONTENT_LENGTH = 28;
const HEADER_CHROME_LENGTH = 3;

export type AutoColumnWidthOptions = {
  properties: readonly PropertyConfig[];
  rows: readonly AssetRow[];
  containerWidth: number;
  fixedColumnWidth: number;
};

export function getAutoTableWidth(
  columnWidths: Record<string, number>,
  fixedColumnWidth: number,
  containerWidth: number,
): number {
  const columnsWidth = Object.values(columnWidths)
    .reduce((total, width) => total + width, fixedColumnWidth);
  return Math.max(containerWidth, columnsWidth);
}

function getDisplayLength(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return Array.from(value).length;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).length;

  if (Array.isArray(value)) {
    return value.reduce((length, item) => length + getDisplayLength(item) + 2, -2);
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const label = record.name ?? record.title ?? record.label ?? record.url;
    if (typeof label === 'string') return Array.from(label).length;
    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  }

  return String(value).length;
}

/**
 * Gives short columns their minimum readable width, then shares remaining
 * table space according to headers and the visible cells' content density.
 */
export function getAutoColumnWidths({
  properties,
  rows,
  containerWidth,
  fixedColumnWidth,
}: AutoColumnWidthOptions): Record<string, number> {
  if (properties.length === 0) return {};

  const availableWidth = Math.max(0, containerWidth - fixedColumnWidth);
  const remainingWidth = Math.max(0, availableWidth - properties.length * MIN_COLUMN_WIDTH);
  const weights = properties.map((property) => {
    const headerLength = Array.from(property.name).length + HEADER_CHROME_LENGTH;
    const longestValue = rows.reduce(
      (longest, row) => Math.max(longest, getDisplayLength(row.propertyValues[property.key])),
      0,
    );
    return Math.max(1, Math.min(MAX_CONTENT_LENGTH, Math.max(headerLength, longestValue)));
  });
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const proportionalExtras = weights.map(
    (weight) => (remainingWidth * weight) / totalWeight,
  );
  const allocatedExtras = proportionalExtras.map((width) => Math.floor(width));
  let pixelsLeft = remainingWidth - allocatedExtras.reduce((total, width) => total + width, 0);

  // Keep the total at the available width: rounding each column separately can
  // otherwise create enough artificial overflow to show an unnecessary scrollbar.
  const indicesByRemainder = proportionalExtras
    .map((width, index) => ({ index, remainder: width - allocatedExtras[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of indicesByRemainder) {
    if (pixelsLeft <= 0) break;
    allocatedExtras[index] += 1;
    pixelsLeft -= 1;
  }

  return properties.reduce<Record<string, number>>((widths, property, index) => {
    widths[property.id] = MIN_COLUMN_WIDTH + allocatedExtras[index];
    return widths;
  }, {});
}
