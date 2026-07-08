import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.join(process.cwd(), 'src/lib/contexts/LibraryDataContext.tsx'),
  'utf8'
);

describe('LibraryDataContext hot path', () => {
  it('does not use a fixed 100ms sleep before broadcasting cell edits', () => {
    expect(source).not.toContain('setTimeout(resolve, 100)');
    expect(source).not.toContain('setTimeout((resolve), 100)');
  });
});
