import { describe, expect, it } from '@jest/globals';
import { getUnauthenticatedAction } from '../../../src/lib/auth/proxyPolicy';

describe('proxy auth policy', () => {
  it.each([
    '/',
    '/auth/callback',
    '/auth/reset-password',
    '/forgot-password',
    '/accept-invitation',
    '/decline-invitation',
    '/api/invitations/accept',
    '/api/invitations/decline',
    '/_next/static/chunk.js',
    '/favicon.ico',
    '/logo.png',
  ])('allows public path %s', (pathname) => {
    expect(getUnauthenticatedAction(pathname)).toEqual({ type: 'next' });
  });

  it.each(['/projects', '/project-1', '/project-1/library-1', '/simulation-system'])(
    'allows unauthenticated dashboard page %s through (client-side auth gate renders login in place)',
    (pathname) => {
      // Pages are NOT server-redirected: DashboardLayout renders AuthForm in
      // place for unauthenticated users, and a server redirect to a public
      // route would loop (`/` -> `/projects` -> ...). The proxy still
      // refreshes the cookie session for authenticated users.
      expect(getUnauthenticatedAction(pathname)).toEqual({ type: 'next' });
    }
  );

  it('never emits a redirect action (avoids the /auth/login dead route and redirect loops)', () => {
    for (const pathname of ['/projects', '/project-1/library-1', '/', '/api/projects']) {
      expect(getUnauthenticatedAction(pathname).type).not.toBe('redirect');
    }
  });

  it.each(['/api/projects', '/api/projects/project-1/role', '/api/search/assets'])(
    'returns JSON 401 for unauthenticated API %s',
    (pathname) => {
      expect(getUnauthenticatedAction(pathname)).toEqual({
        type: 'json',
        status: 401,
        body: { error: 'Authentication required' },
      });
    }
  );
});
