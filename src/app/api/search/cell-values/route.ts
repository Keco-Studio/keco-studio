import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/createSupabaseServerClient';

type Params = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export async function GET(req: Request) {
  const supabase = createSupabaseServerClient(req);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

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
    return NextResponse.json(
      { error: error.message ?? 'search failed' },
      { status: 400 }
    );
  }

  return NextResponse.json({ results: data ?? [] });
}

