import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DESKTOP_MODE_STORAGE_KEY, isDesktopModeSearch } from '@/lib/desktopMode';

const read = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('desktop mode', () => {
  it('recognizes only desktop=1', () => {
    expect(isDesktopModeSearch('?desktop=1')).toBe(true);
    expect(isDesktopModeSearch('?desktop=0')).toBe(false);
    expect(isDesktopModeSearch('?other=1')).toBe(false);
  });

  it('mounts the marker in the root layout and keeps Google OAuth available in desktop mode', () => {
    expect(read('src/app/layout.tsx')).toContain('<DesktopModeMarker />');
    expect(read('src/components/authform/AuthForm.tsx')).toContain(DESKTOP_MODE_STORAGE_KEY);
    expect(read('src/components/authform/AuthForm.tsx')).toMatch(/isDesktopMode !== null[\s\S]*Log in using Google/);
  });

  it('derives the auth guard from the current URL before relying on the persisted marker', () => {
    const source = read('src/components/authform/AuthForm.tsx');
    expect(source).toMatch(
      /isDesktopModeSearch\(window\.location\.search\)[\s\S]{0,160}isDesktopModeSession\(window\.sessionStorage\)/
    );
    expect(source).toContain("const [isDesktopMode, setIsDesktopMode] = useState<boolean | null>(null);");
    expect(source).toContain("window.sessionStorage.setItem(DESKTOP_MODE_STORAGE_KEY, '1')");
    expect(source).toContain('isDesktopMode !== null ?');
    expect(source).toContain('if (isDesktopMode)');
    expect(source).toContain('beginDesktopGoogleOAuth');
    expect(source).toContain('supabase.auth.signInWithOAuth');
  });

  it('shows a generic retryable error after a native OAuth failure marker', () => {
    const source = read('src/components/authform/AuthForm.tsx');
    expect(source).toContain("searchParams.get('oauth_error') === 'desktop_oauth_failed'");
    expect(source).toContain('Unable to complete desktop sign-in. Please try again.');
  });

  it('persists desktop mode when client-side navigation changes the search parameters', () => {
    const source = read('src/components/desktop/DesktopModeMarker.tsx');
    expect(source).toContain("import { useSearchParams } from 'next/navigation'");
    expect(source).toContain('const searchParams = useSearchParams();');
    expect(source).toContain('[searchParams]');
  });
});
