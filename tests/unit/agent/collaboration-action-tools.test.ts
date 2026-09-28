import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/services/authorizationService', () => ({ getUserProjectRole: jest.fn() }));
jest.mock('@/lib/services/collaborationService', () => ({ sendInvitation: jest.fn(),
  CollaborationServiceError: class CollaborationServiceError extends Error {} }));

import { getUserProjectRole } from '@/lib/services/authorizationService';
import { sendInvitation } from '@/lib/services/collaborationService';
import { listProjectCollaboratorsTool, inviteProjectCollaboratorTool,
  changeProjectCollaboratorRoleTool, removeProjectCollaboratorTool } from '@/lib/agent/tools/collaboration-actions';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), userId = id(2), collaboratorId = id(3), targetUserId = id(4);
let ctx: ToolContext;
let role: 'admin' | 'editor' | 'viewer';
let row: Record<string, unknown>;
let calls: Array<[string, ...unknown[]]>;

beforeEach(() => {
  jest.clearAllMocks();
  role = 'admin'; calls = [];
  row = { id: collaboratorId, project_id: projectId, user_id: targetUserId,
    role: 'editor', updated_at: '2026-09-28T00:00:00Z', accepted_at: '2026-09-20' };
  jest.mocked(getUserProjectRole).mockImplementation(async () => ({ role, isOwner: false }));
  jest.mocked(sendInvitation).mockResolvedValue(id(5));
  const from = jest.fn((table: string) => {
    const filters: Array<[string, unknown]> = [];
    let operation: 'read' | 'update' | 'delete' = 'read';
    let patch: Record<string, unknown> = {};
    let range: [number, number] | null = null;
    const query = {
      select() { return this; },
      eq(column: string, value: unknown) { filters.push([column, value]); calls.push(['eq', table, column, value]); return this; },
      is() { return this; }, not() { return this; }, order() { return this; },
      limit() { return this; },
      range(start: number, end: number) { range = [start, end]; calls.push(['range', table, start, end]); return this; },
      update(value: Record<string, unknown>) { operation = 'update'; patch = value; calls.push(['update', table, value]); return this; },
      delete() { operation = 'delete'; calls.push(['delete', table]); return this; },
      async maybeSingle() {
        if (table === 'projects') return { data: { id: projectId, name: 'Test project' }, error: null };
        if (table === 'profiles') return { data: { username: 'Inviter', email: 'inviter@example.com' }, error: null };
        if (table !== 'project_collaborators') return { data: null, error: null };
        const matches = filters.every(([column, value]) => row[column] === value);
        if (!matches) return { data: null, error: null };
        if (operation === 'update') Object.assign(row, patch);
        return { data: operation === 'delete' ? { id: row.id } : { ...row }, error: null };
      },
      then(resolve: (value: unknown) => unknown) {
        const data = table === 'project_collaborators' ? [row] : table === 'collaboration_invitations'
          ? [{ id: id(6), recipient_user_id: id(7), recipient_email: 'pending@example.com', role: 'viewer' }] : [];
        return Promise.resolve(resolve({ data: range ? data.slice(range[0], range[1] + 1) : data, error: null }));
      },
    };
    return query;
  });
  ctx = { userId, projectId, workspace: 'studio', conversationId: id(9),
    supabase: { from } as unknown as SupabaseClient };
});

it('bounds discovery and hides pending invitations from nonadmins', async () => {
  expect(await listProjectCollaboratorsTool.execute({ projectId, limit: 20 }, ctx))
    .toMatchObject({ success: true, data: { collaborators: [{ id: collaboratorId }],
      pendingInvitations: [{ id: id(6) }] } });
  expect(calls).toContainEqual(['range', 'project_collaborators', 0, 20]);
  expect(calls).toContainEqual(['range', 'collaboration_invitations', 0, 20]);
  role = 'viewer';
  expect(await listProjectCollaboratorsTool.execute({ projectId }, ctx))
    .toMatchObject({ success: true, data: { pendingInvitations: [] } });
  expect(await listProjectCollaboratorsTool.execute({ projectId, limit: 51 }, ctx))
    .toMatchObject({ success: false });
});

it('invites exact normalized email with the UI role matrix', async () => {
  role = 'editor';
  expect(await inviteProjectCollaboratorTool.execute({ projectId,
    recipientEmail: '  Invitee@Example.com ', role: 'viewer' }, ctx))
    .toMatchObject({ success: true, data: { invitationId: id(5), recipientEmail: 'invitee@example.com' } });
  expect(sendInvitation).toHaveBeenCalledWith(ctx.supabase,
    { projectId, recipientEmail: 'invitee@example.com', role: 'viewer' }, userId, 'Inviter', 'Test project');
  expect(await inviteProjectCollaboratorTool.execute({ projectId,
    recipientEmail: 'invitee@example.com', role: 'admin' }, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('not allowed') });
});

it('confirms and rejects a stale role replacement', async () => {
  expect(changeProjectCollaboratorRoleTool.confirmationPolicy).toBe('always');
  const prepared = await changeProjectCollaboratorRoleTool.prepareConfirmation!({ projectId, collaboratorId, newRole: 'viewer' }, ctx);
  expect(prepared).toMatchObject({ success: true, preview: { collaboratorId, previousRole: 'editor', newRole: 'viewer' } });
  row.role = 'admin';
  expect(await changeProjectCollaboratorRoleTool.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('changed after approval') });
  row.role = 'editor';
  expect(await changeProjectCollaboratorRoleTool.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: true, data: { role: 'viewer', beforeRole: 'editor' } });
  expect(calls).toContainEqual(['eq', 'project_collaborators', 'updated_at', '2026-09-28T00:00:00Z']);
});

it('confirms exact removal, rejects self-removal and scope drift', async () => {
  expect(removeProjectCollaboratorTool.confirmationPolicy).toBe('always');
  const prepared = await removeProjectCollaboratorTool.prepareConfirmation!({ projectId, collaboratorId }, ctx);
  expect(prepared).toMatchObject({ success: true, preview: { userId: targetUserId, consequence: expect.stringContaining('Remove') } });
  expect(await removeProjectCollaboratorTool.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: true, data: { removed: true } });
  row.user_id = userId;
  expect(await removeProjectCollaboratorTool.prepareConfirmation!({ projectId, collaboratorId }, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('yourself') });
  expect(await removeProjectCollaboratorTool.prepareConfirmation!({ projectId: id(99), collaboratorId }, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('outside this conversation') });
});
