import { listFieldTypes } from '../../../src/lib/agent/workflows/list-field-types';
import { FIELD_TYPE_CATALOG } from '../../../src/lib/agent/field-type-catalog';
import { allTools, resolveTool } from '../../../src/lib/agent/tools';
import type { ToolContext } from '../../../src/lib/agent/types';

const ctx = {} as ToolContext;

describe('list_field_types skill', () => {
  it('is a read-category tool that needs no parameters', () => {
    expect(listFieldTypes.name).toBe('list_field_types');
    expect(listFieldTypes.category).toBe('read');
    expect(listFieldTypes.parameters).toEqual({ type: 'object', properties: {}, required: [] });
  });

  it('returns the full catalog with media types flagged', async () => {
    const result = await listFieldTypes.execute({}, ctx);
    expect(result.success).toBe(true);
    const fieldTypes = (result.data as { fieldTypes: typeof FIELD_TYPE_CATALOG }).fieldTypes;
    expect(fieldTypes).toEqual(FIELD_TYPE_CATALOG);
    expect(fieldTypes.find((t) => t.dataType === 'image')?.isMedia).toBe(true);
  });

  it('is registered in the tool registry', () => {
    expect(resolveTool('list_field_types')).toBe(listFieldTypes);
    expect(allTools).toContain(listFieldTypes);
  });
});
