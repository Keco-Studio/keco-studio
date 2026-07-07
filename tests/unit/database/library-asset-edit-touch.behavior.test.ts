/**
 * Real-Postgres behavior test for issue #161: cell-edit timestamp fan-out is
 * collapsed into one RPC while preserving edit authorization.
 *
 * Gated by RLS_DB_TESTS=1 (CI only). See helpers/rlsTestClient.ts.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  teardownProjectFixture,
  type ProjectFixture,
} from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

function timestampMs(value: string | null | undefined): number {
  expect(typeof value).toBe('string');
  const parsed = Date.parse(value as string);
  expect(Number.isNaN(parsed)).toBe(false);
  return parsed;
}

describeDb('touch_library_asset_edit_updated_at RPC (issue #161, live DB)', () => {
  let fx: ProjectFixture;

  beforeAll(async () => {
    fx = await buildProjectFixture();
  }, 60_000);

  afterAll(async () => {
    if (fx) await teardownProjectFixture(fx);
  }, 30_000);

  async function seedAsset(label: string): Promise<{ assetId: string; updatedAt: string }> {
    const { data, error } = await fx.svc
      .from('library_assets')
      .insert({
        library_id: fx.libraryId,
        name: `rpc-touch-${label}-${fx.suffix}`,
      })
      .select('id, updated_at')
      .single();

    if (error || !data) throw new Error(`seedAsset failed: ${error?.message}`);
    return { assetId: data.id as string, updatedAt: data.updated_at as string };
  }

  it('lets an editor touch the edited asset and ancestor timestamps', async () => {
    const asset = await seedAsset('editor');
    const { data: libraryBefore } = await fx.svc
      .from('libraries')
      .select('updated_at')
      .eq('id', fx.libraryId)
      .single();
    const { data: projectBefore } = await fx.svc
      .from('projects')
      .select('updated_at')
      .eq('id', fx.projectId)
      .single();

    await new Promise((resolve) => setTimeout(resolve, 20));

    const { data: touchedAt, error } = await fx.editor.client.rpc(
      'touch_library_asset_edit_updated_at',
      {
        p_asset_id: asset.assetId,
        p_library_id: fx.libraryId,
      }
    );

    expect(error).toBeNull();
    expect(touchedAt).toEqual(expect.any(String));

    const { data: assetAfter } = await fx.svc
      .from('library_assets')
      .select('updated_at')
      .eq('id', asset.assetId)
      .single();
    const { data: libraryAfter } = await fx.svc
      .from('libraries')
      .select('updated_at')
      .eq('id', fx.libraryId)
      .single();
    const { data: projectAfter } = await fx.svc
      .from('projects')
      .select('updated_at')
      .eq('id', fx.projectId)
      .single();

    expect(assetAfter?.updated_at).toBe(touchedAt);
    expect(timestampMs(assetAfter?.updated_at)).toBeGreaterThan(timestampMs(asset.updatedAt));
    expect(timestampMs(libraryAfter?.updated_at)).toBeGreaterThan(
      timestampMs(libraryBefore?.updated_at as string)
    );
    expect(timestampMs(projectAfter?.updated_at)).toBeGreaterThan(
      timestampMs(projectBefore?.updated_at as string)
    );
  });

  it('blocks a viewer collaborator from touching edit timestamps', async () => {
    const asset = await seedAsset('viewer');

    const { error } = await fx.viewer.client.rpc('touch_library_asset_edit_updated_at', {
      p_asset_id: asset.assetId,
      p_library_id: fx.libraryId,
    });

    expect(error).not.toBeNull();
  });
});
