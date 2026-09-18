import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { readOwnAccountStorage } from '@/lib/server/accountStorage';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export const GET = withAuth(async function GET(_request, _context, { supabase }) {
  try {
    const summary = await readOwnAccountStorage(supabase);
    return NextResponse.json(summary, { headers: NO_STORE });
  } catch {
    console.error('[GET /api/account/storage] Unable to load account storage');
    return NextResponse.json(
      { error: 'Unable to load account storage' },
      { status: 503, headers: NO_STORE },
    );
  }
}, {
  unauthorizedResponse: () => NextResponse.json(
    { error: 'Please sign in to continue' },
    { status: 401, headers: NO_STORE },
  ),
});
