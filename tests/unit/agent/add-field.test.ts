import {
  normalizeFieldDataType,
  SUPPORTED_FIELD_DATA_TYPES,
} from '../../../src/lib/agent/field-data-type';

describe('normalizeFieldDataType', () => {
  it('accepts canonical data types', () => {
    expect(normalizeFieldDataType('int')).toBe('int');
    expect(normalizeFieldDataType('string')).toBe('string');
    expect(normalizeFieldDataType('boolean')).toBe('boolean');
  });

  it('maps common aliases', () => {
    expect(normalizeFieldDataType('integer')).toBe('int');
    expect(normalizeFieldDataType('Integer')).toBe('int');
    expect(normalizeFieldDataType('text')).toBe('string');
    expect(normalizeFieldDataType('number')).toBe('int');
  });

  it('accepts image and file canonical types', () => {
    expect(normalizeFieldDataType('image')).toBe('image');
    expect(normalizeFieldDataType('file')).toBe('file');
  });

  it('returns null for unsupported types', () => {
    expect(normalizeFieldDataType('unknown')).toBeNull();
    expect(normalizeFieldDataType('')).toBeNull();
  });
});

describe('SUPPORTED_FIELD_DATA_TYPES', () => {
  it('includes image and file', () => {
    expect(SUPPORTED_FIELD_DATA_TYPES).toContain('image');
    expect(SUPPORTED_FIELD_DATA_TYPES).toContain('file');
  });

  it('every supported type round-trips through normalizeFieldDataType', () => {
    for (const dataType of SUPPORTED_FIELD_DATA_TYPES) {
      expect(normalizeFieldDataType(dataType)).toBe(dataType);
    }
  });
});
