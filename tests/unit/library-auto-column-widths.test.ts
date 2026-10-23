import { describe, expect, it } from '@jest/globals';
import * as autoColumnWidthsModule from '@/components/libraries/utils/autoColumnWidths';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

const { getAutoColumnWidths, getAutoTableLayout, getAutoTableWidth } = autoColumnWidthsModule;

const property = (id: string, name: string): PropertyConfig => ({
  id,
  key: id,
  name,
  valueType: 'string',
  dataType: 'string',
  orderIndex: 0,
});

const row = (propertyValues: Record<string, unknown>): AssetRow => ({
  id: crypto.randomUUID(),
  libraryId: 'library',
  name: 'row',
  propertyValues,
});

describe('getAutoColumnWidths', () => {
  it('allocates more room to columns with denser visible content', () => {
    const widths = getAutoColumnWidths({
      properties: [property('type', 'Type'), property('properties', 'Properties')],
      rows: [
        row({ type: 'NPC', properties: 'A character with dialogue, quests, and relationship metadata.' }),
        row({ type: 'Item', properties: 'The item grants a temporary defensive bonus after use.' }),
      ],
      containerWidth: 920,
      fixedColumnWidth: 100,
    });

    expect(widths.properties).toBeGreaterThan(widths.type);
  });

  it('keeps every auto-sized column at a readable minimum', () => {
    const widths = getAutoColumnWidths({
      properties: [property('a', 'A'), property('b', 'B')],
      rows: [row({ a: 'x', b: 'y' })],
      containerWidth: 120,
      fixedColumnWidth: 60,
    });

    expect(widths.a).toBeGreaterThanOrEqual(96);
    expect(widths.b).toBeGreaterThanOrEqual(96);
  });

  it('caps the influence of one exceptionally long value', () => {
    const widths = getAutoColumnWidths({
      properties: [property('short', 'Short'), property('long', 'Long')],
      rows: [row({ short: 'brief', long: 'x'.repeat(10_000) })],
      containerWidth: 920,
      fixedColumnWidth: 60,
    });

    expect(widths.long).toBeLessThan(700);
  });

  it('does not create horizontal overflow from per-column rounding', () => {
    const widths = getAutoColumnWidths({
      properties: [
        property('a', 'A'),
        property('b', 'B'),
        property('c', 'C'),
        property('d', 'D'),
      ],
      rows: [],
      containerWidth: 446,
      fixedColumnWidth: 60,
    });

    expect(Object.values(widths).reduce((total, width) => total + width, 0)).toBeLessThanOrEqual(386);
  });

  it('uses the container width when auto columns fit inside it', () => {
    expect(getAutoTableWidth({ type: 120, properties: 180 }, 100, 600)).toBe(600);
  });

  it('expands only when the calculated columns cannot fit', () => {
    expect(getAutoTableWidth({ type: 160, properties: 260 }, 100, 400)).toBe(520);
  });

  it('keeps fixed columns at their declared width while a table has no data columns', () => {
    expect(getAutoTableLayout({}, 100, 1000)).toEqual({
      tableWidth: '100px',
      tableMinWidth: '100px',
    });
  });

  it('assigns unmeasured table space only to data columns', () => {
    expect(getAutoTableLayout({ name: 96 }, 100, 0)).toEqual({
      tableWidth: '100%',
      unmeasuredColumnWidth: 'calc((100% - 100px) / 1)',
    });
    expect(getAutoTableLayout({ name: 96, type: 96 }, 60, 0)).toEqual({
      tableWidth: '100%',
      unmeasuredColumnWidth: 'calc((100% - 60px) / 2)',
    });
  });
});
