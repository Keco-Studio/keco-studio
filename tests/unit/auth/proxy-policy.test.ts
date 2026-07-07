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
    'redirects unauthenticated dashboard page %s',
    (pathname) => {
      expect(getUnauthenticatedAction(pathname)).toEqual({
        type: 'redirect',
        destination: '/auth/login',
      });
    }
  );

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
