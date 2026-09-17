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
});
