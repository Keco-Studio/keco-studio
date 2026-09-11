import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { isKecoAdminUser } from '@/lib/server/kecoAdminAuthorization';
import { readKecoAdminOverview } from '@/lib/server/kecoAdminOverview';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

export const GET = withAuth(async function GET(_request, _context, { user }) {
  if (!isKecoAdminUser(user.id)) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const overview = await readKecoAdminOverview(
      getSupabaseServiceRoleClient(),
    );
    return NextResponse.json(overview, { headers: NO_STORE_HEADERS });
  } catch {
    console.error('[GET /api/keco-admin/overview] Unable to load overview');
    return NextResponse.json(
      { error: 'Unable to load Keco Admin data' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}, {
  unauthorizedResponse: () => NextResponse.json(
    { error: 'Please sign in to continue' },
    { status: 401, headers: NO_STORE_HEADERS },
  ),
});
