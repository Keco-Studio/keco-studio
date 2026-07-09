export type UnauthenticatedAction =
  | { type: 'next' }
  | { type: 'redirect'; destination: string }
  | { type: 'json'; status: 401; body: { error: string } };

const PUBLIC_PAGE_PATHS = new Set([
  '/',
  '/forgot-password',
  '/accept-invitation',
  '/decline-invitation',
]);

const PUBLIC_API_PATHS = new Set([
  '/api/invitations/accept',
  '/api/invitations/decline',
]);

const PUBLIC_FILE_EXTENSION_RE = /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml)$/i;

export function shouldBypassProxyAuth(): boolean {
  return process.env.NODE_ENV === 'development';
}

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PAGE_PATHS.has(pathname)) {
    return true;
  }

  if (pathname.startsWith('/auth/')) {
    return true;
  }

  if (pathname.startsWith('/_next/')) {
    return true;
  }

  if (PUBLIC_FILE_EXTENSION_RE.test(pathname)) {
    return true;
  }

  if (PUBLIC_API_PATHS.has(pathname)) {
    return true;
  }

  return false;
}

export function isProtectedApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/') && !isPublicPath(pathname);
}

export function isProtectedPagePath(pathname: string): boolean {
  if (isPublicPath(pathname) || isProtectedApiPath(pathname)) {
    return false;
  }

  return true;
}

export function getUnauthenticatedAction(pathname: string): UnauthenticatedAction {
  if (isPublicPath(pathname)) {
    return { type: 'next' };
  }

  if (isProtectedApiPath(pathname)) {
    return {
      type: 'json',
      status: 401,
      body: { error: 'Authentication required' },
    };
  }

  // Protected PAGE, unauthenticated: let the request through. The client-side
  // auth gate (DashboardLayout) renders AuthForm in place — there is no
  // standalone login URL. A server redirect is intentionally NOT emitted:
  //   - `/auth/login` never existed and fell through to [projectId]/[libraryId],
  //     which is the bug that surfaced as "Project not found";
  //   - redirecting to `/` loops (`/` server-redirects to `/projects`).
  // For authenticated users the proxy (src/proxy.ts) still refreshes the cookie
  // session; this branch only governs genuinely unauthenticated page requests.
  return { type: 'next' };
}
