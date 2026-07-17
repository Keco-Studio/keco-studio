import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/components/libraries/hooks/useClipboardOperations.ts'),
  'utf8',
);

describe('library rich clipboard wiring', () => {
  it('routes copy and cut through the shared rich clipboard writer', () => {
    expect(source).toContain("from './libraryRichClipboard'");
    expect(source.match(/serializeLibraryClipboardMatrix\(clipboardArray\)/g)).toHaveLength(2);
    expect(source.match(/writeLibraryClipboard\(clipboardPayload\)/g)).toHaveLength(2);
    expect(source).not.toContain('navigator.clipboard.writeText');
  });
});
