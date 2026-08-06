import { describe, expect, it } from '@jest/globals';
import {
  detectScriptColumns,
  orderProperties,
} from '@/components/libraries/utils/tableStructure';
import type { PropertyConfig } from '@/lib/types/libraryAssets';

const property = (id: string, name: string, orderIndex: number): PropertyConfig => ({
  id,
  key: id,
  name,
  valueType: 'string',
  dataType: 'string',
  orderIndex,
});

describe('flat library table structure helpers', () => {
  it('orders all properties globally', () => {
    expect(orderProperties([
      property('third', 'Third', 2),
      property('first', 'First', 0),
      property('second', 'Second', 1),
    ]).map((item) => item.id)).toEqual(['first', 'second', 'third']);
  });

  it('detects visual novel script columns from the flat field list', () => {
    const result = detectScriptColumns([
      property('name', 'Speaker', 0),
      property('content', 'Dialogue and options', 1),
    ]);
    expect(result.hasScriptColumns).toBe(true);
    expect(result.scriptColumns.nameKey).toBe('name');
    expect(result.scriptColumns.contentKey).toBe('content');
  });
});
