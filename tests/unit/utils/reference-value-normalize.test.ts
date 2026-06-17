import {
  normalizeReferenceSelections,
  resolveReferenceSelectionLabel,
} from '../../../src/lib/utils/referenceValue';

describe('normalizeReferenceSelections', () => {
  it('parses a direct selection object array', () => {
    expect(
      normalizeReferenceSelections([{ assetId: 'a-1', fieldId: 'f-1' }])
    ).toEqual([{ assetId: 'a-1', fieldId: 'f-1', fieldLabel: null, displayValue: null }]);
  });

  it('unwraps LLM mistake: single object wrapped in item key', () => {
    expect(
      normalizeReferenceSelections({
        item: { assetId: 'a-1', fieldId: 'f-1' },
      })
    ).toEqual([{ assetId: 'a-1', fieldId: 'f-1', fieldLabel: null, displayValue: null }]);
  });

  it('unwraps LLM mistake: array elements wrapped in item key', () => {
    expect(
      normalizeReferenceSelections([
        { item: { assetId: 'a-1', fieldId: 'f-1' } },
        { item: { assetId: 'a-2', fieldId: 'f-2' } },
      ])
    ).toEqual([
      { assetId: 'a-1', fieldId: 'f-1', fieldLabel: null, displayValue: null },
      { assetId: 'a-2', fieldId: 'f-2', fieldLabel: null, displayValue: null },
    ]);
  });

  it('unwraps item key containing an array of selections', () => {
    expect(
      normalizeReferenceSelections({
        item: [
          { assetId: 'a-1', fieldId: 'f-1' },
          { assetId: 'a-2', fieldId: 'f-2' },
        ],
      })
    ).toEqual([
      { assetId: 'a-1', fieldId: 'f-1', fieldLabel: null, displayValue: null },
      { assetId: 'a-2', fieldId: 'f-2', fieldLabel: null, displayValue: null },
    ]);
  });

  it('accepts a single bare selection object (non-array)', () => {
    expect(
      normalizeReferenceSelections({ assetId: 'a-1', fieldId: 'f-1' })
    ).toEqual([{ assetId: 'a-1', fieldId: 'f-1', fieldLabel: null, displayValue: null }]);
  });
});

describe('resolveReferenceSelectionLabel', () => {
  it('skips placeholder Untitled displayValue and uses cache', () => {
    const label = resolveReferenceSelectionLabel(
      { assetId: 'a-1', fieldId: 'f-1', displayValue: 'Untitled' },
      { 'a-1:f-1': '商铺' }
    );
    expect(label).toBe('商铺');
  });

  it('skips Untitled cache entries and falls back to asset-level cache', () => {
    const label = resolveReferenceSelectionLabel(
      { assetId: 'a-1', fieldId: 'wrong-f', displayValue: null },
      { 'a-1:wrong-f': 'Untitled', 'a-1': '商铺' }
    );
    expect(label).toBe('商铺');
  });
});
