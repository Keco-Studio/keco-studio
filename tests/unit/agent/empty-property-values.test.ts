import {
  buildEmptyPropertyValuesError,
  isExplicitEmptyPropertyValues,
} from '../../../src/lib/agent/field-resolver';

describe('isExplicitEmptyPropertyValues', () => {
  it('returns false when propertyValues is omitted', () => {
    expect(isExplicitEmptyPropertyValues({ name: 'Test' })).toBe(false);
  });

  it('returns true when propertyValues is an empty object', () => {
    expect(isExplicitEmptyPropertyValues({ name: 'Test', propertyValues: {} })).toBe(true);
  });

  it('returns false when propertyValues has at least one field', () => {
    expect(
      isExplicitEmptyPropertyValues({ propertyValues: { 货币类型: '免费货币' } })
    ).toBe(false);
  });

  it('returns false after normalizing a top-level item wrapper into real fields', () => {
    expect(
      isExplicitEmptyPropertyValues({
        propertyValues: { item: { 货币类型: '免费货币' } },
      })
    ).toBe(false);
  });

  it('returns false when item wrapper normalizes to a spurious empty item key', () => {
    // normalize keeps { item: {} } as one key; rare LLM output — not the main empty-object bug.
    expect(isExplicitEmptyPropertyValues({ propertyValues: { item: {} } })).toBe(false);
  });
});

describe('buildEmptyPropertyValuesError', () => {
  it('lists available fields and includes an example key', () => {
    const msg = buildEmptyPropertyValuesError(['名称', '货币类型']);
    expect(msg).toContain('propertyValues is empty');
    expect(msg).toContain('名称');
    expect(msg).toContain('货币类型');
  });
});
