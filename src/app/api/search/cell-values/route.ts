import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';

type CellSearchRow = {
  project_id?: string;
  library_id?: string;
  library_name?: string;
  asset_id?: string;
  asset_name?: string;
  field_id?: string;
  field_label?: string;
  value_snippet?: string;
  asset_updated_at?: string | null;
  project_name?: string | null;
  folder_name?: string | null;
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

  const results = (Array.isArray(data) ? data : []) as CellSearchRow[];
  if (results.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const libraryIds = [...new Set(results.flatMap((result) => {
    const value = result.library_id;
    return typeof value === 'string' && value ? [value] : [];
  }))];
  if (libraryIds.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const { data: libraryRows, error: libraryError } = await supabase
    .from('libraries')
    .select('id, project_id, folder_id, document_export_type')
    .in('id', libraryIds);

  if (libraryError) {
    console.error('[GET /api/search/cell-values] Library enrichment failed:', libraryError);
    return NextResponse.json(
      { error: 'Cell value search failed' },
      { status: 400 }
    );
  }

  const projectIds = [...new Set((libraryRows ?? []).flatMap((row) => {
    const id = row.project_id;
    return typeof id === 'string' && id ? [id] : [];
  }))];
  const folderIds = [...new Set((libraryRows ?? []).flatMap((row) => {
    const id = row.folder_id;
    return typeof id === 'string' && id ? [id] : [];
  }))];

  const [{ data: projectRows }, { data: folderRows }] = await Promise.all([
    projectIds.length
      ? supabase.from('projects').select('id, name').in('id', projectIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    folderIds.length
      ? supabase.from('folders').select('id, name').in('id', folderIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);

  const projectNameById = new Map(
    (projectRows ?? []).map((row) => [String(row.id), String(row.name ?? '')])
  );
  const folderNameById = new Map(
    (folderRows ?? []).map((row) => [String(row.id), String(row.name ?? '')])
  );

  const libraryMeta = new Map<
    string,
    { projectName: string; folderName: string; isScript: boolean }
  >();
  for (const row of libraryRows ?? []) {
    libraryMeta.set(String(row.id), {
      projectName: projectNameById.get(String(row.project_id ?? '')) ?? '',
      folderName: row.folder_id ? (folderNameById.get(String(row.folder_id)) ?? '') : '',
      isScript: row.document_export_type === 'script',
    });
  }

  const enriched = results
    .filter((result) => {
      const meta = libraryMeta.get(String(result.library_id ?? ''));
      if (!meta) return false;
      if (includeScript) return true;
      return !meta.isScript;
    })
    .map((result) => {
      const meta = libraryMeta.get(String(result.library_id ?? ''));
      return {
        ...result,
        project_name: meta?.projectName ?? '',
        folder_name: meta?.folderName ?? '',
      };
    });

  return NextResponse.json({ results: enriched });
}, {
  unauthorizedResponse: () =>
    NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
});
