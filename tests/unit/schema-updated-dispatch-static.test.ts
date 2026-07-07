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

describe('schemaUpdated dispatch coverage', () => {
  it('invalidates schema-dependent caches for inline schema edits', () => {
    expect(libraryPageSource).toMatch(/dispatchEvent\(new CustomEvent\('schemaUpdated'/);
    expect(tableHeaderSource).toMatch(/dispatchEvent\(new CustomEvent\('schemaUpdated'/);
    expect(editColumnModalSource).toMatch(/dispatchEvent\(new CustomEvent\('schemaUpdated'/);
  });
});
