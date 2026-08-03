import { describe, expect, it } from '@jest/globals';
import {
  importNameFromFile,
  nextImportName,
  normalizeImportNotes,
} from '@/components/shared/importResourceForm';

describe('shared import resource form helpers', () => {
  it('derives document and table names from the final file extension', () => {
    expect(importNameFromFile('world.design.md', 'document')).toBe('world.design');
    expect(importNameFromFile('characters.xlsx', 'table')).toBe('characters');
    expect(importNameFromFile('.md', 'document')).toBe('Imported document');
    expect(importNameFromFile('.csv', 'table')).toBe('Imported table');
  });

  it('tracks the file name until the user edits Name', () => {
    expect(nextImportName({
      currentName: '',
      fileName: 'first.docx',
      kind: 'document',
      nameEdited: false,
    })).toBe('first');
    expect(nextImportName({
      currentName: 'Custom name',
      fileName: 'replacement.docx',
      kind: 'document',
      nameEdited: true,
    })).toBe('Custom name');
  });

  it('trims notes and maps blank notes to null', () => {
    expect(normalizeImportNotes('  Reference notes  ')).toBe('Reference notes');
    expect(normalizeImportNotes('   ')).toBeNull();
  });
});
