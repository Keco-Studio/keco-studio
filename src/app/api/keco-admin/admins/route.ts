import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { hasKecoAdminAccess, isKecoAdminUser } from '@/lib/server/kecoAdminAuthorization';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import type { KecoAdministrator } from '@/lib/types/kecoAdmin';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readEmail(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const email = (body as Record<string, unknown>).email;
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  return EMAIL_PATTERN.test(normalized) ? normalized : null;
}

type AdministratorGrant = {
  user_id: string;
  created_at: string;
};

type AdministratorProfile = {
  id: string;
  email: string | null;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function displayName(profile: AdministratorProfile | undefined): string {
  return readText(profile?.full_name)
    ?? readText(profile?.username)
    ?? readText(profile?.email)?.split('@')[0]
    ?? 'Unknown administrator';
}

export const GET = withAuth(async function GET(_request, _context, { supabase, user }) {
  if (!(await hasKecoAdminAccess(user.id, supabase))) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const service = getSupabaseServiceRoleClient();
    const { data: grantRows, error: grantsError } = await service
      .from('keco_admin_users')
      .select('user_id, created_at')
      .order('created_at', { ascending: true });
    if (grantsError || !Array.isArray(grantRows)) {
      throw new Error('Unable to read Keco Admin grants');
    }

    const grants = grantRows as AdministratorGrant[];
    const configuredAdminId = process.env.KECO_ADMIN_USER_ID;
    const fallbackAdminId = configuredAdminId && isKecoAdminUser(configuredAdminId, configuredAdminId)
      ? configuredAdminId
      : null;
    const ids = [...new Set([
      ...grants.map((grant) => grant.user_id),
      ...(fallbackAdminId ? [fallbackAdminId] : []),
    ])];

    const { data: profileRows, error: profilesError } = ids.length === 0
      ? { data: [], error: null }
      : await service
        .from('profiles')
        .select('id, email, username, full_name, avatar_url')
        .in('id', ids);
    if (profilesError || !Array.isArray(profileRows)) {
      throw new Error('Unable to read Keco Admin profiles');
    }

    const profilesById = new Map(
      (profileRows as AdministratorProfile[]).map((profile) => [profile.id, profile]),
    );
    const grantedAtById = new Map(grants.map((grant) => [grant.user_id, grant.created_at]));
    const administrators: KecoAdministrator[] = ids.map((id) => {
      const profile = profilesById.get(id);
      return {
        id,
        displayName: displayName(profile),
        email: readText(profile?.email),
        avatarUrl: readText(profile?.avatar_url),
        grantedAt: grantedAtById.get(id) ?? null,
      };
    });

    return NextResponse.json({ administrators }, { headers: NO_STORE_HEADERS });
  } catch {
    console.error('[GET /api/keco-admin/admins] Unable to load administrators');
    return NextResponse.json(
      { error: 'Unable to load administrators' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}, {
  unauthorizedResponse: () => NextResponse.json(
    { error: 'Please sign in to continue' },
    { status: 401, headers: NO_STORE_HEADERS },
  ),
});

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
