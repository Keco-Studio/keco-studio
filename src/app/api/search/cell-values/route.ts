import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';

type Params = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export const GET = withAuth(async function GET(
  req,
  _context,
  { supabase }
) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const includeScript = url.searchParams.get('includeScript') === 'true';
  const limitParam = Number(url.searchParams.get('limit') ?? '30');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 30;

  if (!q) {
    return NextResponse.json({ results: [] });
  }

  const { data, error } = await supabase.rpc('search_library_cell_values', {
    p_query: q,
    p_limit: limit,
  });

  if (error) {
    console.error('[GET /api/search/cell-values] Search failed:', error);
    return NextResponse.json(
      { error: 'Cell value search failed' },
      { status: 400 }
    );
  }

  const results = Array.isArray(data) ? data : [];
  if (includeScript || results.length === 0) {
    return NextResponse.json({ results });
  }

  const libraryIds = [...new Set(results.flatMap((result) => {
    const value = (result as { library_id?: unknown }).library_id;
    return typeof value === 'string' && value ? [value] : [];
  }))];
  if (libraryIds.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const { data: studioLibraries, error: libraryError } = await supabase
    .from('libraries')
    .select('id')
    .in('id', libraryIds)
    .or('document_export_type.is.null,document_export_type.neq.script');

  if (libraryError) {
    console.error('[GET /api/search/cell-values] Library isolation failed:', libraryError);
    return NextResponse.json(
      { error: 'Cell value search failed' },
      { status: 400 }
    );
  }

  const studioLibraryIds = new Set((studioLibraries ?? []).map((library) => library.id));
  return NextResponse.json({
    results: results.filter((result) => (
      studioLibraryIds.has((result as { library_id?: string }).library_id ?? '')
    )),
  });
}, {
  unauthorizedResponse: () =>
    NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
});
