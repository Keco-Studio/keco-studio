import {
  applyQueryAssetFilters,
  buildNonEmptyCellEntries,
  buildQueryAssetRows,
  buildQueryAssetSummary,
  buildReferenceTargetsFromAssets,
  countLeadingEmptyUiRows,
  findEmptyReferenceTargetIds,
  findFirstEmptyUiRowAsset,
  sortQueryAssetRowsByRowIndex,
} from '../../../src/lib/agent/asset-emptiness';
import type { AssetRow } from '../../../src/lib/types/libraryAssets';

describe('buildQueryAssetRows display emptiness', () => {
  it('treats rows with only blank values as empty', () => {
    const assets: AssetRow[] = [
      {
        id: 'a1',
        libraryId: 'lib',
        name: 'Untitled',
        propertyValues: { f1: 'ID value' },
      },
      {
        id: 'a2',
        libraryId: 'lib',
        name: 'Untitled',
        propertyValues: { f1: '', f2: null },
      },
      {
        id: 'a3',
        libraryId: 'lib',
        name: 'Untitled',
        propertyValues: {},
      },
    ];
    const rows = buildQueryAssetRows(assets, { f1: 'ID', f2: 'name' }, ['f1', 'f2']);
    expect(rows[0]).toMatchObject({
      id: 'a1',
      rowIndex: 1,
      isEmpty: false,
      displayLabel: 'ID value',
      filledColumns: ['ID'],
    });
    expect(rows[1]).toMatchObject({ id: 'a2', rowIndex: 2, isEmpty: true, displayLabel: '', filledColumns: [] });
    expect(rows[2]).toMatchObject({ id: 'a3', rowIndex: 3, isEmpty: true, displayLabel: '', filledColumns: [] });
  });

  it('assigns rowIndex by UI sort order not raw row_index gaps', () => {
    const rows = buildQueryAssetRows(
      [
        { id: 'c', libraryId: 'lib', name: 'Untitled', propertyValues: { f1: 'c' }, rowIndex: 30 },
        { id: 'a', libraryId: 'lib', name: 'Untitled', propertyValues: { f1: 'a' }, rowIndex: 10 },
      ],
      { f1: 'ID' },
      ['f1']
    );
    expect(rows.map((r) => r.id)).toEqual(['a', 'c']);
    expect(rows[0].rowIndex).toBe(1);
    expect(rows[1].rowIndex).toBe(2);
  });

  it('uses created_at tiebreaker when row_index ties (matches table row numbers)', () => {
    const rows = buildQueryAssetRows(
      [
        {
          id: 'later-id-zzzz',
          libraryId: 'lib',
          name: 'Untitled',
          propertyValues: { f1: 'with-data' },
          rowIndex: 1,
          created_at: '2026-04-09T12:52:47.602Z',
        },
        {
          id: 'aaaa-first',
          libraryId: 'lib',
          name: 'Untitled',
          propertyValues: {},
          rowIndex: 1,
          created_at: '2026-04-09T12:52:47.601Z',
        },
      ],
      { f1: 'ID' },
      ['f1']
    );
    expect(rows.map((r) => r.id)).toEqual(['aaaa-first', 'later-id-zzzz']);
    expect(rows[0].rowIndex).toBe(1);
    expect(rows[1].rowIndex).toBe(2);
  });

  it('uses first non-empty column for displayLabel', () => {
    const rows = buildQueryAssetRows(
      [
        {
          id: 'a4',
          libraryId: 'lib',
          name: 'Untitled',
          propertyValues: { f1: '', f2: 'int' },
        },
      ],
      { f1: 'ID', f2: 'type' },
      ['f1', 'f2']
    );
    expect(rows[0]).toMatchObject({
      isEmpty: false,
      displayLabel: 'int',
      filledColumns: ['type'],
    });
  });
});

describe('applyQueryAssetFilters', () => {
  const rows = buildQueryAssetRows(
    [
      { id: 'a1', libraryId: 'lib', name: 'Alpha', propertyValues: { f1: 'x' }, rowIndex: 1 },
      { id: 'a2', libraryId: 'lib', name: 'Untitled', propertyValues: { f1: '' }, rowIndex: 2 },
      { id: 'a3', libraryId: 'lib', name: 'Beta', propertyValues: { f1: 'y', f2: 'z' }, rowIndex: 3 },
    ],
    { f1: 'ID', f2: 'type' },
    ['f1', 'f2']
  );

  it('excludes empty rows by default', () => {
    const filtered = applyQueryAssetFilters(rows, {});
    expect(filtered.map((r) => r.id)).toEqual(['a1', 'a3']);
  });

  it('includes empty rows when includeEmpty is true', () => {
    const filtered = applyQueryAssetFilters(rows, { includeEmpty: true });
    expect(filtered.map((r) => r.id)).toEqual(['a1', 'a2', 'a3']);
    expect(filtered.find((r) => r.id === 'a2')?.isEmpty).toBe(true);
  });

  it('applies nameFilter after empty filter', () => {
    const filtered = applyQueryAssetFilters(rows, { includeEmpty: true, nameFilter: 'untitled' });
    expect(filtered.map((r) => r.id)).toEqual(['a2']);
  });

  it('applies type filter on values', () => {
    const filtered = applyQueryAssetFilters(rows, { type: 'z', typeFieldLabel: 'type' });
    expect(filtered.map((r) => r.id)).toEqual(['a3']);
  });

  it('applies limit last', () => {
    const filtered = applyQueryAssetFilters(rows, { limit: 1 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('a1');
  });

  it('rowIndex returns only that UI row even when empty', () => {
    const filtered = applyQueryAssetFilters(rows, { rowIndex: 2 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('a2');
    expect(filtered[0].isEmpty).toBe(true);
  });
});

describe('buildNonEmptyCellEntries', () => {
  it('flattens every visible cell across non-empty rows', () => {
    const rows = buildQueryAssetRows(
      [
        {
          id: 'a1',
          libraryId: 'lib',
          name: 'Untitled',
          propertyValues: { f1: 'hsss', f2: 'vesss' },
        },
        { id: 'a2', libraryId: 'lib', name: 'Untitled', propertyValues: { f2: 'version4' } },
        { id: 'a3', libraryId: 'lib', name: 'Untitled', propertyValues: { f3: 'int' } },
      ],
      { f1: 'ID', f2: 'IDDD', f3: 'type' },
      ['f1', 'f2', 'f3']
    );
    const cells = buildNonEmptyCellEntries(rows, { ID: 'f1', IDDD: 'f2', type: 'f3' });
    expect(cells).toHaveLength(4);
    expect(cells.map((c) => `${c.rowIndex}:${c.column}:${c.fieldId}`)).toEqual([
      '1:ID:f1',
      '1:IDDD:f2',
      '2:IDDD:f2',
      '3:type:f3',
    ]);
  });
});

describe('buildReferenceTargetsFromAssets', () => {
  it('returns one target per non-empty cell with fieldId', () => {
    const targets = buildReferenceTargetsFromAssets(
      [
        {
          id: 'a1',
          libraryId: 'lib',
          name: 'Untitled',
          propertyValues: { f1: 'hsss', f2: 'vesss' },
        },
        { id: 'a2', libraryId: 'lib', name: 'Untitled', propertyValues: { f2: 'version4' } },
      ],
      [
        { key: 'f1', name: 'ID' },
        { key: 'f2', name: 'IDDD' },
      ]
    );
    expect(targets).toHaveLength(3);
    expect(targets[0]).toMatchObject({
      assetId: 'a1',
      fieldId: 'f1',
      fieldLabel: 'ID',
      displayValue: 'hsss',
      rowIndex: 1,
    });
    expect(targets[1]).toMatchObject({ assetId: 'a1', fieldId: 'f2', displayValue: 'vesss' });
    expect(targets[2]).toMatchObject({ assetId: 'a2', fieldId: 'f2', displayValue: 'version4' });
  });
});

describe('buildQueryAssetSummary', () => {
  it('reports asset vs cell counts and empty exclusions', () => {
    const allRows = buildQueryAssetRows(
      [
        { id: 'a1', libraryId: 'lib', name: 'Untitled', propertyValues: { f1: 'x', f2: 'y' } },
        { id: 'a2', libraryId: 'lib', name: 'Untitled', propertyValues: {} },
      ],
      { f1: 'ID', f2: 'IDDD' },
      ['f1', 'f2']
    );
    const returned = applyQueryAssetFilters(allRows, { includeEmpty: false });
    const summary = buildQueryAssetSummary(allRows, returned, { includeEmpty: false }, { ID: 'f1', IDDD: 'f2' });
    expect(summary).toEqual({
      totalAssets: 2,
      nonEmptyAssetCount: 1,
      nonEmptyCellCount: 2,
      returnedRows: 1,
      emptyAssetsExcluded: 1,
      leadingEmptyRowCount: 0,
    });
  });
});

describe('findFirstEmptyUiRowAsset', () => {
  it('returns the topmost empty row in UI order', () => {
    const assets: AssetRow[] = [
      { id: 'empty-top', libraryId: 'lib', name: 'Untitled', propertyValues: {}, rowIndex: 1 },
      { id: 'filled', libraryId: 'lib', name: 'Untitled', propertyValues: { f1: 'x' }, rowIndex: 2 },
      { id: 'empty-bottom', libraryId: 'lib', name: 'Untitled', propertyValues: {}, rowIndex: 3 },
    ];
    expect(findFirstEmptyUiRowAsset(assets)).toEqual({
      asset: assets[0],
      rowIndex: 1,
    });
  });

  it('returns null when every row has visible data', () => {
    const assets: AssetRow[] = [
      { id: 'a1', libraryId: 'lib', name: 'Untitled', propertyValues: { f1: 'x' } },
    ];
    expect(findFirstEmptyUiRowAsset(assets)).toBeNull();
  });
});

describe('countLeadingEmptyUiRows', () => {
  it('counts only leading empty rows before the first filled row', () => {
    const rows = buildQueryAssetRows(
      [
        { id: 'e1', libraryId: 'lib', name: 'Untitled', propertyValues: {}, rowIndex: 1 },
        { id: 'e2', libraryId: 'lib', name: 'Untitled', propertyValues: { f1: '' }, rowIndex: 2 },
        { id: 'filled', libraryId: 'lib', name: 'Untitled', propertyValues: { f1: 'data' }, rowIndex: 3 },
        { id: 'e3', libraryId: 'lib', name: 'Untitled', propertyValues: {}, rowIndex: 4 },
      ],
      { f1: 'ID' },
      ['f1']
    );
    expect(countLeadingEmptyUiRows(rows)).toBe(2);
  });
});

describe('sortQueryAssetRowsByRowIndex', () => {
  it('sorts by rowIndex ascending', () => {
    const rows = sortQueryAssetRowsByRowIndex([
      { id: 'b', name: 'Untitled', rowIndex: 3, values: {}, isEmpty: true, displayLabel: '' },
      { id: 'a', name: 'Untitled', rowIndex: 1, values: {}, isEmpty: true, displayLabel: '' },
    ]);
    expect(rows.map((r) => r.rowIndex)).toEqual([1, 3]);
  });
});

describe('findEmptyReferenceTargetIds', () => {
  it('returns asset ids with no visible values', async () => {
    const supabase = {
      from() {
        return {
          select() {
            return {
              in() {
                return Promise.resolve({
                  data: [
                    { asset_id: 'filled-1', field_id: 'f1', value_json: 'hello' },
                    { asset_id: 'blank-1', field_id: 'f1', value_json: '' },
                  ],
                  error: null,
                });
              },
            };
          },
        };
      },
    } as unknown as Parameters<typeof findEmptyReferenceTargetIds>[0];

    const empty = await findEmptyReferenceTargetIds(supabase, ['filled-1', 'blank-1', 'missing-1']);
    expect(empty.sort()).toEqual(['blank-1', 'missing-1'].sort());
  });
});
