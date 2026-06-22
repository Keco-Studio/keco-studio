import {
  applyCellValueReplace,
  findNormalizedMatchSpan,
  replaceAllInDisplay,
  valueToDisplayString,
} from '@/lib/utils/cellValueReplace';

describe('valueToDisplayString', () => {
  it('serializes plain JSON objects for string fields', () => {
    expect(valueToDisplayString({ damageRatio: 0.1, levelBonus: 5 }, 'string')).toBe(
      '{"damageRatio":0.1,"levelBonus":5}'
    );
  });
});

describe('cellValueReplace reference fields', () => {
  it('replaces entire matching reference displayValue', () => {
    const currentValue = [
      {
        assetId: 'asset-1',
        fieldId: 'field-notes',
        displayValue: 'Alpha findToken value',
      },
    ];

    expect(findNormalizedMatchSpan(valueToDisplayString(currentValue, 'reference'), 'findToken')).not.toBeNull();

    const result = applyCellValueReplace({
      currentValue,
      dataType: 'reference',
      find: 'findToken',
      replace: 'replacedToken',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.afterDisplay).toBe('replacedToken');
    expect(result.newValue).toEqual([
      expect.objectContaining({
        assetId: 'asset-1',
        displayValue: 'replacedToken',
      }),
    ]);
  });

  it('rejects reference cells with no matching displayValue', () => {
    const result = applyCellValueReplace({
      currentValue: [{ assetId: 'a1', displayValue: 'no match here' }],
      dataType: 'reference',
      find: 'missing',
      replace: 'x',
    });
    expect(result.ok).toBe(false);
  });
});

describe('replaceAllInDisplay', () => {
  it('does not loop when replace text contains find text', () => {
    expect(replaceAllInDisplay('0.5', '0.5', '0.52')).toBe('0.52');
  });

  it('replaces multiple non-overlapping occurrences', () => {
    expect(replaceAllInDisplay('0.50.5', '0.5', '0.52')).toBe('0.520.52');
  });
});

describe('applyCellValueReplace whole-cell semantics', () => {
  it('sets the entire cell value instead of replacing each match', () => {
    const result = applyCellValueReplace({
      currentValue: 'hrrr',
      dataType: 'string',
      find: 'r',
      replace: 'ss',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.afterDisplay).toBe('ss');
    expect(result.newValue).toBe('ss');
  });

  it('replaces float cell value when find is a prefix of replace', () => {
    const result = applyCellValueReplace({
      currentValue: 0.5,
      dataType: 'float',
      find: '0.5',
      replace: '0.52',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.afterDisplay).toBe('0.52');
    expect(result.newValue).toBe(0.52);
  });
});

describe('boolean cell search and replace', () => {
  it('displays unset boolean cells as false for search', () => {
    expect(valueToDisplayString(null, 'boolean')).toBe('false');
    expect(valueToDisplayString(undefined, 'boolean')).toBe('false');
  });

  it('matches true and false in boolean cells', () => {
    expect(findNormalizedMatchSpan(valueToDisplayString(true, 'boolean'), 'true')).not.toBeNull();
    expect(findNormalizedMatchSpan(valueToDisplayString(false, 'boolean'), 'false')).not.toBeNull();
    expect(findNormalizedMatchSpan(valueToDisplayString(null, 'boolean'), 'false')).not.toBeNull();
  });

  it('replaces boolean cell value entirely', () => {
    const result = applyCellValueReplace({
      currentValue: true,
      dataType: 'boolean',
      find: 'true',
      replace: 'false',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.afterDisplay).toBe('false');
    expect(result.newValue).toBe(false);
  });
});
