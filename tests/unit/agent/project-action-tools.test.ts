import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';
import { getProject, updateProject } from '@/lib/services/projectService';
import { verifyProjectDeletionPermission, verifyProjectUpdatePermission } from '@/lib/services/authorizationService';
import { deleteProjectWithServerBoundary } from '@/lib/server/projectDeletion';
import { deleteProjectTool } from '@/lib/agent/tools/delete-project';
import { updateProjectTool } from '@/lib/agent/tools/update-project';

jest.mock('next/server', () => ({ after: jest.fn() }));
jest.mock('@/lib/services/projectService', () => ({ getProject: jest.fn(), updateProject: jest.fn() }));
jest.mock('@/lib/services/authorizationService', () => ({
  verifyProjectDeletionPermission: jest.fn(), verifyProjectUpdatePermission: jest.fn(),
}));
jest.mock('@/lib/server/projectDeletion', () => ({
  deleteProjectWithServerBoundary: jest.fn(), processProjectStorageCleanupJob: jest.fn(),
}));

const projectId = '11111111-1111-4111-8111-111111111111';
const otherProjectId = '22222222-2222-4222-8222-222222222222';
const updatedAt = '2026-09-28T00:00:00.000Z';
const fingerprint = 'a'.repeat(64);
const rpc = jest.fn();
const client = { rpc } as unknown as SupabaseClient;
const context: ToolContext = {
  userId: 'user-1', conversationId: 'conversation-1', workspace: 'projects', supabase: client,
};
const project = {
  id: projectId, owner_id: 'user-1', name: 'Original', description: 'Old',
  created_at: updatedAt, updated_at: updatedAt,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getProject).mockResolvedValue(project);
  jest.mocked(updateProject).mockResolvedValue(undefined);
  jest.mocked(verifyProjectDeletionPermission).mockResolvedValue(undefined);
  jest.mocked(verifyProjectUpdatePermission).mockResolvedValue(undefined);
  jest.mocked(deleteProjectWithServerBoundary).mockResolvedValue({ cleanupJobId: null, cleanupJobIds: [] });
  rpc.mockResolvedValue({ data: {
    projectId, name: 'Original', updatedAt, fingerprint,
    rowCount: 4, tableCounts: { 'public.projects': 1, 'public.documents': 3 },
  }, error: null });
});

describe('project action tools', () => {
  it('updates only an explicit authorized project and returns an invalidation', async () => {
    const prepared = await updateProjectTool.prepareConfirmation!({ projectId, name: 'Renamed' }, context);
    if (!prepared.success) throw new Error('Expected update preview');
    jest.mocked(getProject).mockResolvedValueOnce(project).mockResolvedValueOnce({
      ...project, name: 'Renamed', updated_at: '2026-09-28T00:01:00.000Z',
    });
    const result = await updateProjectTool.execute(prepared.args, context);
    expect(verifyProjectUpdatePermission).toHaveBeenCalledWith(client, projectId, 'user-1');
    expect(updateProject).toHaveBeenCalledWith(client, projectId, { name: 'Renamed', description: 'Old', expectedUpdatedAt: updatedAt });
    expect(result).toMatchObject({ success: true, data: { projectId, name: 'Renamed' }, invalidations: [{ type: 'projects', projectId }] });
    expect((await updateProjectTool.execute({ name: 'Renamed' }, context)).success).toBe(false);
  });

  it('rejects unauthorized updates and a stale confirmed update', async () => {
    jest.mocked(verifyProjectUpdatePermission).mockRejectedValueOnce(new Error('Only admin users can update projects'));
    const denied = await updateProjectTool.execute({ projectId, name: 'Renamed', expectedUpdatedAt: updatedAt }, context);
    expect(denied.error).toBe('Only admin users can update projects');
    expect(updateProject).not.toHaveBeenCalled();

    const prepared = await updateProjectTool.prepareConfirmation!({ projectId, name: 'Renamed' }, context);
    expect(prepared.success).toBe(true);
    if (!prepared.success) return;
    jest.mocked(getProject).mockResolvedValueOnce({ ...project, updated_at: '2026-09-28T00:02:00.000Z' });
    const stale = await updateProjectTool.execute(prepared.args, context);
    expect(stale.error).toMatch(/changed after approval/);
    expect(updateProject).not.toHaveBeenCalled();
  });

  it('always confirms a description-only update', async () => {
    expect(updateProjectTool.confirmationPolicy).toBe('always');
    const prepared = await updateProjectTool.prepareConfirmation!({ projectId, description: 'New' }, context);
    expect(prepared).toMatchObject({ success: true, args: { projectId, name: 'Original', description: 'New' } });
    expect((await updateProjectTool.execute({ projectId, description: 'New' }, context)).success).toBe(false);
  });

  it('keeps the duplicate-name conflict but masks unexpected project update errors', async () => {
    const input = { projectId, name: 'Renamed', expectedUpdatedAt: updatedAt };
    jest.mocked(updateProject).mockRejectedValueOnce(new Error('Project name Renamed already exists'));
    expect((await updateProjectTool.execute(input, context)).error).toBe('Project name already exists.');
    jest.mocked(updateProject).mockRejectedValueOnce(new Error('internal SQL relation detail'));
    expect((await updateProjectTool.execute(input, context)).error).toBe('Failed to update project.');
    jest.mocked(getProject).mockRejectedValueOnce(new Error('internal read detail'));
    expect((await updateProjectTool.prepareConfirmation!({ projectId, name: 'Renamed' }, context)).error)
      .toBe('Failed to preview project update.');
  });

  it('always confirms deletion with the affected row digest', async () => {
    expect(deleteProjectTool).toMatchObject({ confirmationMode: 'pre_execute', confirmationPolicy: 'always' });
    const prepared = await deleteProjectTool.prepareConfirmation!({ projectId }, context);
    expect(prepared).toMatchObject({
      success: true,
      args: { projectId, expectedName: 'Original', expectedFingerprint: fingerprint },
      preview: { projectId, name: 'Original', updatedAt, affectedRows: 4,
        affectedTables: { 'public.projects': 1, 'public.documents': 3 } },
    });
    expect(verifyProjectDeletionPermission).toHaveBeenCalledWith(client, projectId, 'user-1');
    expect((await deleteProjectTool.execute({ projectId }, context)).success).toBe(false);
    expect(deleteProjectWithServerBoundary).not.toHaveBeenCalled();
  });

  it('rechecks deletion permission and rejects a stale database snapshot', async () => {
    const prepared = await deleteProjectTool.prepareConfirmation!({ projectId }, context);
    if (!prepared.success) throw new Error('Expected a deletion preview');
    jest.mocked(verifyProjectDeletionPermission).mockRejectedValueOnce(new Error('Only admin users can delete projects'));
    expect((await deleteProjectTool.execute(prepared.args, context)).error).toBe('Only admin users can delete projects');
    jest.mocked(deleteProjectWithServerBoundary).mockRejectedValueOnce(new Error('Project contents changed after approval'));
    expect((await deleteProjectTool.execute(prepared.args, context)).error).toMatch(/changed after approval/);
    expect(deleteProjectWithServerBoundary).toHaveBeenCalledTimes(1);
  });

  it('deletes only the approved project and reports the project invalidation', async () => {
    const prepared = await deleteProjectTool.prepareConfirmation!({ projectId }, context);
    if (!prepared.success) throw new Error('Expected a deletion preview');
    jest.mocked(deleteProjectWithServerBoundary).mockRejectedValueOnce(new Error('Project contents changed after approval'));
    expect((await deleteProjectTool.execute({ ...prepared.args as object, projectId: otherProjectId }, context)).success).toBe(false);
    const result = await deleteProjectTool.execute(prepared.args, context);
    expect(deleteProjectWithServerBoundary).toHaveBeenCalledWith({ authClient: client, projectId,
      userId: 'user-1', expectedDeletionFingerprint: fingerprint });
    expect(result).toMatchObject({ success: true, data: { projectId, deleted: true }, invalidations: [{ type: 'projects', projectId }] });
  });

  it('masks unexpected project deletion SQL and storage errors', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX999', message: 'private SQL detail' } });
    expect((await deleteProjectTool.prepareConfirmation!({ projectId }, context)).error)
      .toBe('Failed to preview project deletion.');
    jest.mocked(deleteProjectWithServerBoundary).mockRejectedValueOnce(new Error('private storage detail'));
    expect((await deleteProjectTool.execute({ projectId, expectedName: 'Original',
      expectedFingerprint: fingerprint }, context)).error).toBe('Failed to delete project.');
  });
});
