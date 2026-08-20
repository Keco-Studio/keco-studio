import { describe, expect, it } from '@jest/globals';
import {
  buildDocumentSnapshot,
  buildTableSnapshot,
  enforceSnapshotTotalLimit,
  listGameDesignReferenceOptions,
} from './sourceSnapshots';

jest.mock('@/lib/services/authorizationService', () => ({
  verifyProjectAccess: jest.fn(async () => undefined),
}));

describe('Game Design System source snapshots', () => {
  it('stores actual Document content, identity, update time, and a stable hash', () => {
    const snapshot = buildDocumentSnapshot({
      id: 'doc-1',
      project_id: 'project-1',
      name: 'Combat GDD',
      content: 'Damage uses armor before health.\nChoices expose predicted outcomes.',
      updated_at: '2026-08-14T00:00:00Z',
    });
    expect(snapshot.excerpt).toContain('Damage uses armor before health.');
    expect(snapshot.resourceId).toBe('doc-1');
    expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(buildDocumentSnapshot({ ...snapshotSource(), content: 'changed' }).contentHash).not.toBe(snapshot.contentHash);
  });

  it('stores Table field labels and real row values instead of a table label only', () => {
    const snapshot = buildTableSnapshot({
      library: { id: 'table-1', project_id: 'project-1', name: 'Skills', updated_at: '2026-08-14T00:00:00Z' },
      fields: [
        { id: 'field-cost', label: 'Cost', order_index: 1 },
        { id: 'field-effect', label: 'Effect', order_index: 2 },
      ],
      assets: [{ id: 'asset-1', name: 'Shield Bash', row_index: 1 }],
      values: [
        { asset_id: 'asset-1', field_id: 'field-cost', value_json: 2 },
        { asset_id: 'asset-1', field_id: 'field-effect', value_json: 'Stun one target' },
      ],
    });
    expect(snapshot.excerpt).toContain('Cost');
    expect(snapshot.excerpt).toContain('Shield Bash');
    expect(snapshot.excerpt).toContain('Stun one target');
  });

  it('caps individual sources and rejects aggregate overflow', () => {
    const document = buildDocumentSnapshot({ ...snapshotSource(), content: 'x'.repeat(25_000) });
    expect(document.excerpt).toHaveLength(20_000);
    expect(document.truncated).toBe(true);
    expect(() => enforceSnapshotTotalLimit([
      { ...document, excerpt: 'x'.repeat(40_000) },
      { ...document, resourceId: 'doc-2', excerpt: 'y'.repeat(25_000) },
    ])).toThrow(/60,000/);
  });

  it('filters generated documents and tables when requested', async () => {
    const documentsQuery = sourceQuery([
      { id: 'doc-1', project_id: 'project-1', name: 'Design Notes', updated_at: '2026-08-14T00:00:00Z' },
    ]);
    const librariesQuery = sourceQuery([
      { id: 'table-1', project_id: 'project-1', name: 'Products', updated_at: '2026-08-14T00:00:00Z' },
    ]);
    const supabase = {
      from: jest.fn((table: string) => table === 'documents' ? documentsQuery : librariesQuery),
    } as never;

    await listGameDesignReferenceOptions(supabase, 'project-1', { excludeGeneratedResources: true });

    expect(documentsQuery.is).toHaveBeenCalledWith('gdd_generation_job_id', null);
    expect(librariesQuery.is).toHaveBeenCalledWith('gdd_generation_job_id', null);
  });

  it('keeps generated resources available to the general reference picker by default', async () => {
    const documentsQuery = sourceQuery([]);
    const librariesQuery = sourceQuery([]);
    const supabase = {
      from: jest.fn((table: string) => table === 'documents' ? documentsQuery : librariesQuery),
    } as never;

    await listGameDesignReferenceOptions(supabase, 'project-1');

    expect(documentsQuery.is).not.toHaveBeenCalled();
    expect(librariesQuery.is).not.toHaveBeenCalled();
  });
});

function sourceQuery(data: unknown[]) {
  type Query = {
    select: jest.Mock;
    eq: jest.Mock;
    order: jest.Mock;
    is: jest.Mock;
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise<unknown>;
  };
  const query = {} as Query;
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.is = jest.fn(() => query);
  query.then = (resolve) => Promise.resolve(resolve({ data, error: null }));
  return query;
}

function snapshotSource() {
  return {
    id: 'doc-2',
    project_id: 'project-1',
    name: 'Systems',
    content: 'base',
    updated_at: '2026-08-14T00:00:00Z',
  };
}
