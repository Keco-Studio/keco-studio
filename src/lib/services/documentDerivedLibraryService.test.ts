import { findNewestDocumentScript } from './documentDerivedLibraryService';

function client(result: { data: unknown; error: unknown }) {
  const filters: Array<[string, string]> = [];
  const orders: Array<[string, { ascending: boolean }]> = [];
  const query = {
    select: () => query,
    eq: (column: string, value: string) => { filters.push([column, value]); return query; },
    order: (column: string, options: { ascending: boolean }) => { orders.push([column, options]); return query; },
    limit: () => query,
    maybeSingle: async () => result,
  };
  return { supabase: { from: () => query }, filters, orders };
}

describe('findNewestDocumentScript', () => {
  it('returns the newest script with deterministic ordering', async () => {
    const fake = client({ data: { id: 'lib-new', created_at: '2026-08-13T10:00:00Z' }, error: null });
    await expect(findNewestDocumentScript(fake.supabase as never, 'project', 'document')).resolves.toEqual({
      id: 'lib-new', createdAt: '2026-08-13T10:00:00Z',
    });
    expect(fake.filters).toEqual([
      ['project_id', 'project'], ['source_document_id', 'document'], ['document_export_type', 'script'],
    ]);
    expect(fake.orders).toEqual([
      ['created_at', { ascending: false }], ['id', { ascending: false }],
    ]);
  });

  it('returns null for no script and throws query errors', async () => {
    await expect(findNewestDocumentScript(client({ data: null, error: null }).supabase as never, 'p', 'd')).resolves.toBeNull();
    await expect(findNewestDocumentScript(client({ data: null, error: new Error('query failed') }).supabase as never, 'p', 'd')).rejects.toThrow('query failed');
  });
});
