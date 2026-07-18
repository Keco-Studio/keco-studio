import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { resolveResourceReferences } from '@/lib/documents/resourceReferenceService';
import type { TableRowReferenceTarget } from '@/lib/documents/resourceReferenceTypes';
import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  teardownProjectFixture,
  type ProjectFixture,
} from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

function unavailableClient(): SupabaseClient {
  const from = () => {
    const builder = {
      select: () => builder,
      in: () => builder,
      eq: () => builder,
      or: () => builder,
      order: () => builder,
      range: async () => ({ data: [] as [], error: null }),
      then<TResult1 = { data: []; error: null }, TResult2 = never>(
        onfulfilled?: ((value: { data: []; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ) {
        return Promise.resolve({ data: [] as [], error: null }).then(
          onfulfilled,
          onrejected
        );
      },
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

describe('document resource reference RLS contract', () => {
  it('maps RLS-hidden rows to the same public unavailable result as missing rows', async () => {
    const projectId = randomUUID();
    const target: TableRowReferenceTarget = {
      kind: 'table-row',
      libraryId: randomUUID(),
      assetId: randomUUID(),
      displayFieldId: randomUUID(),
      fallbackLabel: 'Private value',
    };
    const key = `table-row:${target.libraryId}:${target.assetId}:${target.displayFieldId}`;

    await expect(
      resolveResourceReferences(unavailableClient(), projectId, [target])
    ).resolves.toEqual(new Map([
      [key, { key, status: 'unavailable', label: 'Reference unavailable' }],
    ]));
  });
});

describeDb('document resource reference caller RLS (live database)', () => {
  let fx: ProjectFixture;
  let other: ProjectFixture;
  let target: TableRowReferenceTarget;

  beforeAll(async () => {
    fx = await buildProjectFixture();
    other = await buildProjectFixture();
    const { data: field, error: fieldError } = await fx.svc
      .from('library_field_definitions')
      .insert({
        library_id: fx.libraryId,
        section: 'main',
        section_id: `${fx.libraryId}::main`,
        label: 'Status',
        data_type: 'string',
        order_index: 0,
      })
      .select('id')
      .single();
    if (fieldError || !field) throw new Error(`seed field failed: ${fieldError?.message}`);

    const { data: asset, error: assetError } = await fx.svc
      .from('library_assets')
      .insert({ library_id: fx.libraryId, name: 'Ada', row_index: 1 })
      .select('id')
      .single();
    if (assetError || !asset) throw new Error(`seed asset failed: ${assetError?.message}`);

    const { error: valueError } = await fx.svc.from('library_asset_values').insert({
      asset_id: asset.id,
      field_id: field.id,
      value_json: 'Active',
    });
    if (valueError) throw new Error(`seed value failed: ${valueError.message}`);
    target = {
      kind: 'table-row',
      libraryId: fx.libraryId,
      assetId: asset.id,
      displayFieldId: field.id,
      fallbackLabel: 'Old status',
    };
  }, 120_000);

  afterAll(async () => {
    if (fx) await teardownProjectFixture(fx);
    if (other) await teardownProjectFixture(other);
  }, 60_000);

  it('allows owner, admin, editor, and viewer reads', async () => {
    for (const actor of [fx.owner, fx.admin, fx.editor, fx.viewer]) {
      const result = await resolveResourceReferences(actor.client, fx.projectId, [target]);
      expect([...result.values()]).toEqual([
        expect.objectContaining({ status: 'available', label: 'Active' }),
      ]);
    }
  });

  it('returns the uniform unavailable shape for outsider and cross-project callers', async () => {
    const key = `table-row:${target.libraryId}:${target.assetId}:${target.displayFieldId}`;
    for (const [client, projectId] of [
      [fx.outsider.client, fx.projectId],
      [other.editor.client, other.projectId],
    ] as const) {
      await expect(resolveResourceReferences(client, projectId, [target])).resolves
        .toEqual(new Map([
          [key, { key, status: 'unavailable', label: 'Reference unavailable' }],
        ]));
    }
  });
});
