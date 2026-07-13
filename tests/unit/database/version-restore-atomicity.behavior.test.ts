import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  teardownProjectFixture,
  type ProjectFixture,
} from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

describeDb('restore_library_from_snapshot RPC (issue #206, live DB)', () => {
  let fx: ProjectFixture;
  let originalAssetId: string;

  beforeAll(async () => {
    fx = await buildProjectFixture();
    const { data, error } = await fx.svc
      .from('library_assets')
      .insert({ library_id: fx.libraryId, name: `before-restore-${fx.suffix}`, row_index: 0 })
      .select('id')
      .single();
    if (error || !data) throw new Error(`seed asset failed: ${error?.message}`);
    originalAssetId = data.id as string;
  }, 60_000);

  afterAll(async () => {
    if (fx) await teardownProjectFixture(fx);
  }, 30_000);

  it('rolls back deleted assets when a snapshot value cannot be inserted', async () => {
    const replacementAssetId = randomUUID();
    const { error } = await fx.owner.client.rpc('restore_library_from_snapshot', {
      p_library_id: fx.libraryId,
      p_snapshot_data: {
        assets: [
          {
            id: replacementAssetId,
            name: 'replacement',
            rowIndex: 0,
            propertyValues: {
              'not-a-field-uuid': 'forces the statement to fail after asset insertion',
            },
          },
        ],
      },
    });

    expect(error).not.toBeNull();

    const { data: assets, error: readError } = await fx.svc
      .from('library_assets')
      .select('id, name')
      .eq('library_id', fx.libraryId);
    expect(readError).toBeNull();
    expect(assets).toEqual([
      expect.objectContaining({ id: originalAssetId, name: `before-restore-${fx.suffix}` }),
    ]);
  });
});
