import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDesktopSessionHash } from '@/lib/desktopSessionHandoff';

describe('desktop session handoff', () => {
  it('accepts nonempty access and refresh tokens from a URL fragment', () => {
    expect(parseDesktopSessionHash('#access_token=access&refresh_token=refresh')).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
    });
  });

  it.each([
    '',
    '?access_token=access&refresh_token=refresh',
    '#access_token=access',
    '#refresh_token=refresh',
    '#access_token=&refresh_token=refresh',
  ])('rejects incomplete or non-fragment session data: %s', (hash) => {
    expect(parseDesktopSessionHash(hash)).toBeNull();
  });

  it('uses one browser-level replacement to complete desktop sign-in', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/app/auth/desktop/session/page.tsx'),
      'utf8'
    );

    expect(source).toContain("window.location.replace('/projects?desktop=1')");
    expect(source).not.toContain('router.replace(');
    expect(source).not.toContain('history.replaceState(');
  });
});
