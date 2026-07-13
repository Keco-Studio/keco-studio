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

  return NextResponse.json({ results: data ?? [] });
}, {
  unauthorizedResponse: () =>
    NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
});
