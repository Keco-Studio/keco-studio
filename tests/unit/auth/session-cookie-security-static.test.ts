import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

describe('session cookie security', () => {
  it('does not write custom browser-readable Supabase token cookies in proxy', () => {
    const proxySource = readFileSync(path.join(repoRoot, 'src/proxy.ts'), 'utf8');

    expect(proxySource).not.toContain('sb-session');
    expect(proxySource).not.toContain('sb-access-token');
    expect(proxySource).not.toContain('httpOnly: false');
  });

  it('does not use the hybrid cookie/sessionStorage auth adapter in the app provider', () => {
    const providerSource = readFileSync(path.join(repoRoot, 'src/lib/SupabaseContext.tsx'), 'utf8');

    expect(providerSource).not.toContain('hybridStorageAdapter');
    expect(providerSource).not.toContain('createHybridStorageAdapter');
  });

  it.each([
    'src/lib/hybridStorageAdapter.ts',
    'src/lib/sessionStorageAdapter.ts',
    'src/lib/tabIsolatedStorageAdapter.ts',
    'src/lib/utils/cookieStorageAdapter.ts',
    'src/lib/useSupabaseClient.ts',
    'src/lib/supabase.ts',
  ])('removes legacy auth client/storage module %s', (relPath) => {
    expect(() => readFileSync(path.join(repoRoot, relPath), 'utf8')).toThrow();
  });
});
