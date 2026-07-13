import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

type AssetSearchRow = {
  id: string;
  name: string | null;
  library_id: string;
  updated_at: string | null;
  created_at: string | null;
};

type LibrarySearchRow = {
  id: string;
  name: string | null;
  project_id: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const nullableString = (value: unknown): value is string | null =>
  typeof value === 'string' || value === null;

function isAssetSearchRow(value: unknown): value is AssetSearchRow {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.library_id === 'string' &&
    nullableString(value.name) &&
    nullableString(value.updated_at) &&
    nullableString(value.created_at) &&
    isUuid(value.id) &&
    isUuid(value.library_id)
  );
}

function isLibrarySearchRow(value: unknown): value is LibrarySearchRow {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.project_id === 'string' &&
    nullableString(value.name) &&
    isUuid(value.id)
  );
}

export const GET = withAuth(async function GET(
  req,
  _context,
  { supabase }
) {
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
    console.error('[GET /api/search/assets] Failed to search assets:', assetsError);
    return NextResponse.json({ error: 'Asset search failed' }, { status: 400 });
  }

  const safeAssets = (assets ?? []).filter(isAssetSearchRow);
  if (safeAssets.length === 0) return NextResponse.json({ results: [] });

  const libraryIds = Array.from(new Set(safeAssets.map((asset) => asset.library_id))).slice(0, 50);

  const { data: libraries, error: librariesError } = await supabase
    .from('libraries')
    .select('id, name, project_id')
    .in('id', libraryIds);

  if (librariesError) {
    console.error('[GET /api/search/assets] Failed to load libraries:', librariesError);
    return NextResponse.json({ error: 'Asset search failed' }, { status: 400 });
  }

  const libById = new Map<string, LibrarySearchRow>();
  (libraries ?? []).filter(isLibrarySearchRow).forEach((library) => {
    libById.set(library.id, library);
  });

  const results = safeAssets
    .map((asset) => {
      const lib = libById.get(asset.library_id);
      if (!lib) return null;
      return {
        type: 'asset' as const,
        id: asset.id,
        projectId: lib.project_id,
        libraryId: lib.id,
        name: asset.name ?? '',
        hierarchy: String(lib.name ?? ''),
        updatedAt: asset.updated_at ?? asset.created_at ?? null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ results });
}, {
  unauthorizedResponse: () =>
    NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
});
