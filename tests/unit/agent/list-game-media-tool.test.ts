import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';

jest.mock('@/lib/services/authorizationService', () => ({ getUserProjectRole: jest.fn() }));

import { getUserProjectRole } from '@/lib/services/authorizationService';
import { listGameMediaTool } from '@/lib/agent/tools/list-game-media';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = { id: id(4), project_id: id(1), name: 'Background.png',
  category: 'media', status: 'ready', mime_type: 'image/png', storage_bucket: 'project-assets',
  storage_path: `${id(2)}/${id(1)}/asset.png`, sha256: 'a'.repeat(64),
  width: 512, height: 512, has_transparency: false, file_size: 1024,
  created_at: '2026-09-28T00:00:00.000Z', updated_at: '2026-09-28T00:00:00.000Z' };

function setup(rows = [row]) {
  const query = { select: jest.fn(), eq: jest.fn(), order: jest.fn(), range: jest.fn() };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.range.mockResolvedValue({ data: rows, error: null });
  const supabase = { from: jest.fn().mockReturnValue(query) } as unknown as SupabaseClient;
  const ctx: ToolContext = { projectId: id(1), userId: id(2), conversationId: id(3),
    workspace: 'studio', supabase };
  jest.mocked(getUserProjectRole).mockResolvedValue({ role: 'viewer', isOwner: false });
  return { ctx, query };
}

beforeEach(() => jest.resetAllMocks());

it('lists bounded media for a project viewer without exposing storage paths', async () => {
  const { ctx, query } = setup();
  const result = await listGameMediaTool.execute({}, ctx);
  expect(result).toMatchObject({ success: true, data: {
    kind: 'game_media', projectId: id(1), assets: [{ assetId: id(4), name: 'Background.png' }],
    nextOffset: null,
  } });
  expect(query.eq).toHaveBeenCalledWith('project_id', id(1));
  expect(query.eq).toHaveBeenCalledWith('category', 'media');
  expect(query.range).toHaveBeenCalledWith(0, 20);
  expect(JSON.stringify(result)).not.toContain('storage_path');
});

it('caps pages at 50 and rejects foreign rows and revoked membership', async () => {
  const { ctx, query } = setup(Array.from({ length: 51 }, (_, index) => ({ ...row, id: id(100 + index) })));
  const page = await listGameMediaTool.execute({ offset: 4, limit: 50 }, ctx);
  expect(page).toMatchObject({ success: true, data: { nextOffset: 54 } });
  expect((page.data as { assets: unknown[] }).assets).toHaveLength(50);
  expect(query.range).toHaveBeenCalledWith(4, 54);
  query.range.mockResolvedValueOnce({ data: [{ ...row, project_id: id(99) }], error: null });
  expect((await listGameMediaTool.execute({}, ctx)).success).toBe(false);
  jest.mocked(getUserProjectRole).mockRejectedValueOnce(new Error('Access revoked'));
  expect((await listGameMediaTool.execute({}, ctx)).success).toBe(false);
});
