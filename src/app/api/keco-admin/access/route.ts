import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { isKecoAdminUser } from '@/lib/server/kecoAdminAuthorization';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

export const GET = withAuth(async function GET(_request, _context, { user }) {
  return NextResponse.json(
    { isAdmin: isKecoAdminUser(user.id) },
    { headers: NO_STORE_HEADERS },
  );
}, {
  unauthorizedResponse: () => NextResponse.json(
    { error: 'Please sign in to continue' },
    { status: 401, headers: NO_STORE_HEADERS },
  ),
});
