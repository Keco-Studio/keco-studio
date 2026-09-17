import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { readOwnAccountCredits } from '@/lib/server/accountCredits';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

export const GET = withAuth(async function GET(_request, _context, { supabase }) {
  try {
    const summary = await readOwnAccountCredits(supabase);
    return NextResponse.json(summary, { headers: NO_STORE_HEADERS });
  } catch {
    console.error('[GET /api/account/credits] Unable to load account Credits');
    return NextResponse.json(
      { error: 'Unable to load account Credits' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}, {
  unauthorizedResponse: () => NextResponse.json(
    { error: 'Please sign in to continue' },
    { status: 401, headers: NO_STORE_HEADERS },
  ),
});
