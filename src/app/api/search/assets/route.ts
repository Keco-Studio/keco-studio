import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // ignore writes from Route Handlers when not permitted
        }
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const limitParam = Number(url.searchParams.get('limit') ?? '10');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 30) : 10;

  if (!q) {
    return NextResponse.json({ results: [] });
  }

  // MVP: only match on asset name with ILIKE.
  // RLS on `library_assets` + `libraries` should ensure the user only sees permitted data.
  const pattern = `%${q}%`;
  const { data: assets, error: assetsError } = await supabase
    .from('library_assets')
    .select('id, name, library_id, updated_at, created_at')
    .ilike('name', pattern)
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (assetsError) {
    return NextResponse.json({ error: assetsError.message }, { status: 400 });
  }

  const safeAssets = (assets ?? []).filter((a: any) => a && isUuid(String(a.id)) && isUuid(String(a.library_id)));
  if (safeAssets.length === 0) return NextResponse.json({ results: [] });

  const libraryIds = Array.from(new Set(safeAssets.map((a: any) => a.library_id))).slice(0, 50);

  const { data: libraries, error: librariesError } = await supabase
    .from('libraries')
    .select('id, name, project_id')
    .in('id', libraryIds);

  if (librariesError) {
    return NextResponse.json({ error: librariesError.message }, { status: 400 });
  }

  const libById = new Map<string, any>();
  (libraries ?? []).forEach((l: any) => {
    if (!l) return;
    if (isUuid(String(l.id))) libById.set(l.id, l);
  });

  const results = safeAssets
    .map((a: any) => {
      const lib = libById.get(a.library_id);
      if (!lib) return null;
      return {
        type: 'asset' as const,
        id: String(a.id),
        projectId: String(lib.project_id),
        libraryId: String(lib.id),
        name: String(a.name ?? ''),
        hierarchy: String(lib.name ?? ''),
        updatedAt: a.updated_at ?? a.created_at ?? null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ results });
}

