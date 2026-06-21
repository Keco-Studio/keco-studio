import { describe, expect, it } from '@jest/globals';
import {
  buildLibraryRowChunkText,
  buildLibrarySchemaChunkText,
  type LibraryRowChunkInput,
} from '../../../src/lib/agent/chunking';
import type { LibrarySchemaData } from '../../../src/lib/agent/library-schema-builder';

describe('buildLibraryRowChunkText', () => {
  const baseInput: LibraryRowChunkInput = {
    libraryName: 'Items',
    rowIndex: 5,
    assetName: 'Diamond Pack',
    primaryLabel: 'Diamond Pack',
    fields: [
      { label: 'Name', displayValue: 'Diamond Pack', orderIndex: 0 },
      { label: 'Type', displayValue: 'VIP', orderIndex: 1 },
      { label: 'Price', displayValue: '100', orderIndex: 2 },
      { label: 'Description', displayValue: 'Exclusive recharge bundle', orderIndex: 3 },
    ],
  };

  it('formats row summary with library, row index, and field pipe list', () => {
    const text = buildLibraryRowChunkText(baseInput);
    expect(text).toContain('[Items] row 5');
    expect(text).toContain('Diamond Pack');
    expect(text).toContain('Name: Diamond Pack');
    expect(text).toContain('Type: VIP');
    expect(text).toContain('|');
  });

  it('returns null when content is shorter than minimum chars', () => {
    const text = buildLibraryRowChunkText({
      libraryName: 'X',
      rowIndex: 1,
      assetName: 'A',
      fields: [{ label: 'N', displayValue: 'v', orderIndex: 0 }],
    });
    expect(text).toBeNull();
  });

  it('returns null for Untitled asset with no visible fields', () => {
    const text = buildLibraryRowChunkText({
      libraryName: 'Items',
      rowIndex: 3,
      assetName: 'Untitled',
      fields: [],
    });
    expect(text).toBeNull();
  });

  it('orders fields by orderIndex', () => {
    const text = buildLibraryRowChunkText({
      ...baseInput,
      fields: [
        { label: 'Z', displayValue: 'last', orderIndex: 2 },
        { label: 'A', displayValue: 'first', orderIndex: 0 },
        { label: 'M', displayValue: 'mid', orderIndex: 1 },
      ],
    });
    expect(text).not.toBeNull();
    const fieldPart = text!.split('\n')[1];
    expect(fieldPart.indexOf('A: first')).toBeLessThan(fieldPart.indexOf('M: mid'));
    expect(fieldPart.indexOf('M: mid')).toBeLessThan(fieldPart.indexOf('Z: last'));
  });
});

describe('buildLibrarySchemaChunkText', () => {
  const schema: LibrarySchemaData = {
    libraryId: 'lib-1',
    libraryName: 'Items',
    rowCount: 12,
    primaryLabelField: 'Name',
    fields: [
      {
        label: 'Name',
        dataType: 'string',
        required: true,
        valueFormat: 'text',
      },
      {
        label: 'Type',
        dataType: 'enum',
        required: true,
        valueFormat: 'enum',
        enumOptions: ['Paid', 'Consumable', 'VIP'],
      },
      {
        label: 'Price',
        dataType: 'int',
        required: true,
        valueFormat: 'integer',
      },
      {
        label: 'Description',
        dataType: 'string',
        required: false,
        valueFormat: 'text',
      },
    ],
    writeExample: {},
  };

  it('formats schema summary with column count and row count', () => {
    const text = buildLibrarySchemaChunkText(schema);
    expect(text).toContain('[Items] schema');
    expect(text).toContain('4 columns');
    expect(text).toContain('12 non-empty rows');
    expect(text).toContain('Primary label: Name (required)');
    expect(text).toContain('- Name (string, required)');
    expect(text).toContain('options: Paid, Consumable, VIP');
    expect(text).toContain('References: none');
  });

  it('truncates long enum option lists', () => {
    const manyOptions = Array.from({ length: 40 }, (_, i) => `VeryLongCategoryName${i}`);
    const text = buildLibrarySchemaChunkText({
      ...schema,
      fields: [
        {
          label: 'Category',
          dataType: 'enum',
          required: false,
          valueFormat: 'enum',
          enumOptions: manyOptions,
        },
      ],
    });
    expect(text).toContain('…(+');
    expect(text.length).toBeLessThan(1200);
  });
});
