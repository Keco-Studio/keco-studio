import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  teardownProjectFixture,
  type ProjectFixture,
  type RlsUser,
} from './helpers/rlsTestClient';

jest.setTimeout(120_000);

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;
const PNG_SHA256 = 'a'.repeat(64);

type RegistrationOverrides = Partial<{
  name: string;
  category: string;
  mimeType: string;
  sha256: string;
  width: number | null;
  height: number | null;
  hasTransparency: boolean | null;
  fileSize: number;
}>;

describeDb('MCP project game asset registration real Postgres behavior', () => {
  let fx: ProjectFixture;

  beforeAll(async () => {
    fx = await buildProjectFixture();
  }, 120_000);

  afterAll(async () => {
    if (fx) {
      await fx.svc.from('project_game_assets').delete().like('name', `%${fx.suffix}%`);
      await teardownProjectFixture(fx);
    }
  }, 60_000);

  function register(actor: RlsUser, storagePath: string, overrides: RegistrationOverrides = {}) {
    return actor.client.rpc('mcp_register_project_game_asset', {
      p_project_id: fx.projectId,
      p_name: overrides.name ?? `asset-${fx.suffix}`,
      p_category: overrides.category ?? 'character',
      p_mime_type: overrides.mimeType ?? 'image/png',
      p_storage_path: storagePath,
      p_sha256: overrides.sha256 ?? PNG_SHA256,
      p_width: overrides.width ?? 1,
      p_height: overrides.height ?? 1,
      p_has_transparency: overrides.hasTransparency ?? true,
      p_file_size: overrides.fileSize ?? 68,
    });
  }

  it.each(['owner', 'admin', 'editor'] as const)('%s registers an asset', async role => {
    const path = `${fx[role].id}/${fx.projectId}/${role}-${fx.suffix}.png`;
    const result = await register(fx[role], path, { name: `${role}-${fx.suffix}` });

    expect(result.error).toBeNull();
    expect(result.data).toEqual([expect.objectContaining({
      project_id: fx.projectId,
      created_by: fx[role].id,
      storage_path: path,
      reused: false,
    })]);
  });

  it.each(['viewer', 'outsider'] as const)('rejects %s without a row', async role => {
    const path = `${fx[role].id}/${fx.projectId}/${role}-${fx.suffix}.png`;
    const result = await register(fx[role], path, { name: `${role}-${fx.suffix}` });

    expect(result.error?.code).toBe('KA401');
    expect((await fx.svc.from('project_game_assets').select('id').eq('storage_path', path)).data).toEqual([]);
  });

  it('exactly replays a registration with the same id and reused result', async () => {
    const path = `${fx.editor.id}/${fx.projectId}/replay-${fx.suffix}.png`;
    const metadata = { name: `replay-${fx.suffix}` };
    const first = await register(fx.editor, path, metadata);
    const replay = await register(fx.editor, path, metadata);

    expect(first.error).toBeNull();
    expect(replay.error).toBeNull();
    expect(replay.data).toEqual([expect.objectContaining({
      id: first.data?.[0].id,
      reused: true,
    })]);
  });

  it('rejects same-path registrations with different metadata without changing the row', async () => {
    const path = `${fx.editor.id}/${fx.projectId}/conflict-${fx.suffix}.png`;
    const name = `conflict-${fx.suffix}`;
    const created = await register(fx.editor, path, { name, category: 'character' });
    const conflict = await register(fx.editor, path, { name, category: 'icon' });

    expect(created.error).toBeNull();
    expect(conflict.error?.code).toBe('KA409');
    expect((await fx.svc.from('project_game_assets').select('id, category').eq('storage_path', path)).data)
      .toEqual([{ id: created.data?.[0].id, category: 'character' }]);
  });

  it('rejects an actor/project-prefix mismatch without inserting a row', async () => {
    const path = `${fx.admin.id}/${fx.projectId}/mismatch-${fx.suffix}.png`;
    const result = await register(fx.owner, path, { name: `mismatch-${fx.suffix}` });

    expect(result.error?.code).toBe('22023');
    expect((await fx.svc.from('project_game_assets').select('id').eq('storage_path', path)).data).toEqual([]);
  });
});
