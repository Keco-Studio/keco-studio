import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/components/libraries/hooks/useClipboardOperations.ts'),
  'utf8',
);

const sourceBetween = (startMarker: string, endMarker: string): string => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  if (start === -1 || end === -1) {
    throw new Error(`Could not isolate source between ${startMarker} and ${endMarker}`);
  }

  return source.slice(start, end);
};

describe('library rich clipboard wiring', () => {
  it('routes copy and cut through the shared rich clipboard writer', () => {
    const handlerSources = [
      sourceBetween('const handleCut = useCallback', 'const handleCopy = useCallback'),
      sourceBetween('const handleCopy = useCallback', 'const handlePaste = useCallback'),
    ];

    expect(source).toContain("from './libraryRichClipboard'");
    expect(source).not.toContain('navigator.clipboard.writeText');

    handlerSources.forEach((handlerSource) => {
      expect(handlerSource.match(/serializeLibraryClipboardMatrix\(clipboardArray\)/g)).toHaveLength(1);
      expect(handlerSource.match(/writeLibraryClipboard\(clipboardPayload\)/g)).toHaveLength(1);
      expect(handlerSource.match(/void writeLibraryClipboard\(clipboardPayload\)\.catch\(/g)).toHaveLength(1);
      expect(handlerSource).toContain('const clipboardText = clipboardPayload.plainText');
      expect(handlerSource).toContain('tsvSignature: clipboardText');
    });
  });
});
