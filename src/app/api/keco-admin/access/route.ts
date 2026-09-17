import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { hasKecoAdminAccess } from '@/lib/server/kecoAdminAuthorization';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

export const GET = withAuth(async function GET(_request, _context, { supabase, user }) {
  return NextResponse.json(
    { isAdmin: await hasKecoAdminAccess(user.id, supabase) },
    { headers: NO_STORE_HEADERS },
  );
}, {
  unauthorizedResponse: () => NextResponse.json(
    { error: 'Please sign in to continue' },
    { status: 401, headers: NO_STORE_HEADERS },
  ),
});
