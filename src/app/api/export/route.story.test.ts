import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

describe('story workbook export routing', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/export/route.ts'),
    'utf8'
  );

  it('selects the story writer while retaining the generic workbook fallback', () => {
    expect(source).toContain('buildStoryWorkbookSheet');
    expect(source).toContain('writeStoryXlsxWorkbook');
    expect(source).toMatch(/storySheet\s*\?\s*await writeStoryXlsxWorkbook\(storySheet\)/);
    expect(source).toMatch(/:\s*await writeXlsxWorkbook\(outputSheets\)/);
  });
});
