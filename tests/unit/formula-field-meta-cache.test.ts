import { describe, expect, it } from '@jest/globals';
import { createFormulaFieldMetaCache } from '@/lib/library/formulaFieldMetaCache';

describe('createFormulaFieldMetaCache', () => {
  it('returns cached formula metadata without refetching for the same library', async () => {
    let fetchCount = 0;
    const cache = createFormulaFieldMetaCache(async (libraryId) => {
      fetchCount += 1;
      return [
        {
          id: `${libraryId}-formula`,
          label: 'Total',
          data_type: 'formula',
          formula_expression: 'A+B',
        },
      ];
    });

    await expect(cache.get('library-1')).resolves.toHaveLength(1);
    await expect(cache.get('library-1')).resolves.toHaveLength(1);

    expect(fetchCount).toBe(1);
  });

  it('invalidates cached formula metadata after field definitions change', async () => {
    let fetchCount = 0;
    const cache = createFormulaFieldMetaCache(async () => {
      fetchCount += 1;
      return [
        {
          id: `formula-${fetchCount}`,
          label: 'Total',
          data_type: 'formula',
          formula_expression: 'A+B',
        },
      ];
    });

    await expect(cache.get('library-1')).resolves.toMatchObject([{ id: 'formula-1' }]);
    cache.invalidate('library-1');
    await expect(cache.get('library-1')).resolves.toMatchObject([{ id: 'formula-2' }]);

    expect(fetchCount).toBe(2);
  });
});
