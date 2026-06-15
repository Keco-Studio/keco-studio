import { fieldSchema } from '../../src/app/(dashboard)/[projectId]/[libraryId]/predefine/validation';
import { SUPPORTED_FIELD_DATA_TYPES } from '../../src/lib/agent/field-data-type';

describe('predefine fieldSchema dataType', () => {
  it('accepts every supported field data type', () => {
    for (const dataType of SUPPORTED_FIELD_DATA_TYPES) {
      const result = fieldSchema.safeParse({ label: 'x', dataType, required: false });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an unknown data type', () => {
    const result = fieldSchema.safeParse({ label: 'x', dataType: 'unknown', required: false });
    expect(result.success).toBe(false);
  });
});
