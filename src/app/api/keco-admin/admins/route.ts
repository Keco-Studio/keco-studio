import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { hasKecoAdminAccess } from '@/lib/server/kecoAdminAuthorization';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readEmail(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const email = (body as Record<string, unknown>).email;
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  return EMAIL_PATTERN.test(normalized) ? normalized : null;
}

export const POST = withAuth(async function POST(request: NextRequest, _context, { supabase, user }) {
  if (!(await hasKecoAdminAccess(user.id, supabase))) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  let email: string | null = null;
  try {
    email = readEmail(await request.json());
  } catch {
    // Invalid JSON is handled as an invalid invitation request.
  }
  if (!email) {
    return NextResponse.json(
      { error: 'Enter a valid email address' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const service = getSupabaseServiceRoleClient();
    const { data, error } = await service.rpc('grant_keco_admin_by_email', {
      target_email: email,
    });
    const result = Array.isArray(data) ? data[0] : null;
    if (error || !result || typeof result !== 'object') {
      throw new Error('Unable to grant Keco Admin access');
    }
    const status = (result as Record<string, unknown>).status;
    if (status === 'not_found') {
      return NextResponse.json(
        { error: 'No registered Keco user matches this email address' },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    if (status === 'already_admin') {
      return NextResponse.json(
        { status: 'already_admin', email },
        { headers: NO_STORE_HEADERS },
      );
    }
    if (status !== 'granted') throw new Error('Unable to grant Keco Admin access');

    return NextResponse.json(
      { status: 'granted', email },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch {
    console.error('[POST /api/keco-admin/admins] Unable to grant Keco Admin access');
    return NextResponse.json(
      { error: 'Unable to grant Keco Admin access' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}, {
  unauthorizedResponse: () => NextResponse.json(
    { error: 'Please sign in to continue' },
    { status: 401, headers: NO_STORE_HEADERS },
  ),
});
