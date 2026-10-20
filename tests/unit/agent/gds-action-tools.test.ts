import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/services/gameDesignSystemService', () => ({ getGameDesignSystem: jest.fn() }));
jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient: jest.fn() }));

import { getGameDesignSystem } from '@/lib/services/gameDesignSystemService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { updateGameDesignSystemTool } from '@/lib/agent/tools/update-game-design-system';
import { deleteGameDesignSystemTool } from '@/lib/agent/tools/delete-game-design-system';
import { needsConfirmation } from '@/lib/agent/conversation-meta';

const designSystemId = '10000000-0000-4000-8000-000000000001';
const versionId = '10000000-0000-4000-8000-000000000002';
const userId = '10000000-0000-4000-8000-000000000003';
const updatedAt = '2026-09-28T00:00:00Z';
let system: Record<string, unknown>;
let bindings: Array<{ project_id: string }>;
let calls: Array<[string, ...unknown[]]>;
let ctx: ToolContext;

function client() {
  return { from: jest.fn((table: string) => {
    let filters: Array<[string, unknown]> = [];
    let operation: 'read' | 'update' | 'delete' = 'read';
    let patch: Record<string, unknown> = {};
    const query = {
      select(columns: string) { calls.push(['select', table, columns]); return this; },
      update(value: Record<string, unknown>) { operation = 'update'; patch = value; calls.push(['update', table, value]); return this; },
      delete() { operation = 'delete'; calls.push(['delete', table]); return this; },
      eq(column: string, value: unknown) { filters.push([column, value]); calls.push(['eq', table, column, value]); return this; },
      is(column: string, value: unknown) { filters.push([column, value]); calls.push(['is', table, column, value]); return this; },
      limit() { return this; },
      async maybeSingle() {
        if (table === 'project_game_design_systems') return { data: bindings[0] ?? null, error: null };
        const matches = filters.every(([column, value]) => system[column] === value);
        if (!matches) return { data: null, error: null };
        if (operation === 'update') Object.assign(system, patch, { updated_at: '2026-09-28T00:01:00Z' });
        if (operation === 'delete') calls.push(['deleted', table, system.id]);
        return { data: operation === 'delete' ? { id: system.id } : { ...system }, error: null };
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(resolve({ data: table === 'project_game_design_systems' ? bindings : [], error: null }));
      },
    };
    return query;
  }) } as unknown as SupabaseClient;
}

beforeEach(() => {
  jest.clearAllMocks();
  calls = []; bindings = [];
  system = { id: designSystemId, owner_id: userId, source: 'user', title: 'Rules',
    summary: 'Old summary', status: 'draft', current_version_id: versionId, updated_at: updatedAt };
  ctx = { userId, conversationId: userId, workspace: 'game-design-systems', supabase: client() };
  jest.mocked(getGameDesignSystem).mockImplementation(async () => ({ ...system }) as never);
  jest.mocked(getSupabaseServiceRoleClient).mockImplementation(client);
});

describe('Game Design System metadata and delete actions', () => {
  it('always confirms exact-target writes, including Auto mode', () => {
    for (const tool of [updateGameDesignSystemTool, deleteGameDesignSystemTool]) {
      expect(tool.permissionScope).toBe('account');
      expect(tool.confirmationPolicy).toBe('always');
      expect(needsConfirmation(tool, { skipConfirmation: true } as never)).toBe(true);
    }
  });

  it('seals a metadata preview and conditionally updates approved fields', async () => {
    const prepared = await updateGameDesignSystemTool.prepareConfirmation!({ designSystemId, title: 'New Rules' }, ctx);
    expect(prepared).toMatchObject({ success: true, preview: { designSystemId, title: 'Rules' },
      args: { expectedUpdatedAt: updatedAt, expectedVersionId: versionId } });
    const result = await updateGameDesignSystemTool.execute((prepared as { args: unknown }).args, ctx);
    expect(result).toMatchObject({ success: true, data: { designSystemId, before: { title: 'Rules' }, after: { title: 'New Rules' } },
      invalidations: [{ type: 'game-design-systems', designSystemId }] });
    expect(calls).toContainEqual(['update', 'game_design_systems', { title: 'New Rules' }]);
    expect(calls).toContainEqual(['eq', 'game_design_systems', 'updated_at', updatedAt]);
    expect(calls).toContainEqual(['eq', 'game_design_systems', 'current_version_id', versionId]);
  });

  it('denies foreign/official targets before preview or mutation', async () => {
    system.owner_id = '10000000-0000-4000-8000-000000000099';
    expect(await updateGameDesignSystemTool.prepareConfirmation!({ designSystemId, status: 'published' }, ctx))
      .toMatchObject({ success: false, error: expect.stringContaining('Only the owner') });
    system.owner_id = userId; system.source = 'official';
    expect(await deleteGameDesignSystemTool.prepareConfirmation!({ designSystemId }, ctx))
      .toMatchObject({ success: false, error: expect.stringContaining('Only the owner') });
    expect(calls.some(([action]) => action === 'update' || action === 'delete')).toBe(false);
  });

  it('rejects stale approval for metadata and deletion', async () => {
    const edit = await updateGameDesignSystemTool.prepareConfirmation!({ designSystemId, status: 'published' }, ctx);
    const remove = await deleteGameDesignSystemTool.prepareConfirmation!({ designSystemId }, ctx);
    system.current_version_id = '10000000-0000-4000-8000-000000000098';
    expect(await updateGameDesignSystemTool.execute((edit as { args: unknown }).args, ctx))
      .toMatchObject({ success: false, error: expect.stringContaining('changed after approval') });
    expect(await deleteGameDesignSystemTool.execute((remove as { args: unknown }).args, ctx))
      .toMatchObject({ success: false, error: expect.stringContaining('changed after approval') });
    expect(calls.some(([action]) => action === 'update' || action === 'delete')).toBe(false);
  });

  it('blocks bound deletion and deletes an unchanged unbound system', async () => {
    bindings = [{ project_id: '10000000-0000-4000-8000-000000000004' }];
    expect(await deleteGameDesignSystemTool.prepareConfirmation!({ designSystemId }, ctx))
      .toMatchObject({ success: false, error: expect.stringContaining('Unbind') });
    bindings = [];
    const prepared = await deleteGameDesignSystemTool.prepareConfirmation!({ designSystemId }, ctx);
    bindings = [{ project_id: '10000000-0000-4000-8000-000000000004' }];
    expect(await deleteGameDesignSystemTool.execute((prepared as { args: unknown }).args, ctx))
      .toMatchObject({ success: false, error: expect.stringContaining('Unbind') });
    bindings = [];
    expect(await deleteGameDesignSystemTool.execute((prepared as { args: unknown }).args, ctx))
      .toMatchObject({ success: true, data: { designSystemId, deleted: true } });
    expect(calls).toContainEqual(['deleted', 'game_design_systems', designSystemId]);
  });
});
