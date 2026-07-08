import { describe, expect, it } from '@jest/globals';
import { existsSync } from 'node:fs';
import path from 'node:path';

describe('legacy request cache helper', () => {
  it('stays removed after migrating callers to React Query invalidation', () => {
    expect(
      existsSync(path.join(process.cwd(), 'src/lib/utils/safeRequestCache.ts'))
    ).toBe(false);
  });
});
