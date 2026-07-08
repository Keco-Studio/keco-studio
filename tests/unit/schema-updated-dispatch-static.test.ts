import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const libraryPageSource = readFileSync(
  path.join(process.cwd(), 'src/app/(dashboard)/[projectId]/[libraryId]/page.tsx'),
  'utf8'
);
const tableHeaderSource = readFileSync(
  path.join(process.cwd(), 'src/components/libraries/components/TableHeader.tsx'),
  'utf8'
);
const editColumnModalSource = readFileSync(
  path.join(process.cwd(), 'src/components/libraries/components/EditColumnModal.tsx'),
  'utf8'
);

describe('schema invalidation coverage', () => {
  it('uses typed schema invalidation for inline schema edits', () => {
    expect(libraryPageSource).toContain('invalidateLibrarySchemaData');
    expect(tableHeaderSource).toContain('invalidateLibrarySchemaData');
    expect(editColumnModalSource).toContain('invalidateLibrarySchemaData');
  });
});
