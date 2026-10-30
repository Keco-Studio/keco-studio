import type { SupabaseClient } from '@supabase/supabase-js';
import { createProject, updateProject } from '@/lib/services/projectService';
import {
  getCurrentUserId,
  verifyProjectCreation,
  verifyProjectUpdatePermission,
} from '@/lib/services/authorizationService';

jest.mock('@/lib/services/authorizationService', () => ({
  getCurrentUserId: jest.fn(),
  verifyProjectCreation: jest.fn(),
  verifyProjectUpdatePermission: jest.fn(),
}));

const projectId = '11111111-1111-4111-8111-111111111111';
const updatedAt = '2026-09-28T00:00:00.000Z';
const updatedProject = {
  id: projectId,
  owner_id: 'user-1',
  name: 'New',
  description: 'Updated',
  genres: ['RPG'],
  design_philosophies: ['Player Agency'],
  created_at: '2026-09-27T00:00:00.000Z',
  updated_at: '2026-09-28T00:00:01.000Z',
};

function clientWithUpdateResult(data: unknown) {
  const nameCheck = {
    select: jest.fn(), eq: jest.fn(), neq: jest.fn(), limit: jest.fn(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [], error: null })),
  };
  nameCheck.select.mockReturnValue(nameCheck);
  nameCheck.eq.mockReturnValue(nameCheck);
  nameCheck.neq.mockReturnValue(nameCheck);
  nameCheck.limit.mockReturnValue(nameCheck);

  const update = {
    update: jest.fn(), eq: jest.fn(), select: jest.fn(), maybeSingle: jest.fn(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ error: null })),
  };
  update.update.mockReturnValue(update);
  update.eq.mockReturnValue(update);
  update.select.mockReturnValue(update);
  update.maybeSingle.mockResolvedValue({ data, error: null });

  const client = { from: jest.fn().mockReturnValueOnce(nameCheck).mockReturnValueOnce(update) } as unknown as SupabaseClient;
  return { client, update };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUserId).mockResolvedValue('user-1');
  jest.mocked(verifyProjectCreation).mockResolvedValue(undefined);
  jest.mocked(verifyProjectUpdatePermission).mockResolvedValue(undefined);
});

it('rejects invalid project names before create or update writes', async () => {
  const client = {
    from: jest.fn(),
    rpc: jest.fn(),
  } as unknown as SupabaseClient;

  await expect(createProject(client, { name: 'Harbor!' }))
    .rejects.toThrow('No emojis, HTML tags or !@#$% allowed');
  await expect(updateProject(client, projectId, { name: '<Harbor>' }))
    .rejects.toThrow('No emojis, HTML tags or !@#$% allowed');

  expect(client.rpc).not.toHaveBeenCalled();
  expect(client.from).not.toHaveBeenCalled();
});

it('rejects a stale project update in the database write', async () => {
  const { client, update } = clientWithUpdateResult(null);
  await expect(updateProject(client, projectId, {
    name: 'New', description: 'Updated', expectedUpdatedAt: updatedAt,
  })).rejects.toThrow('Project changed after approval');
  expect(update.eq.mock.calls).toEqual([['id', projectId], ['updated_at', updatedAt]]);
  expect(update.select).toHaveBeenCalledWith('*');
});

it('writes the complete Foundation in one update and returns the updated project', async () => {
  const { client, update } = clientWithUpdateResult(updatedProject);
  await expect(updateProject(client, projectId, {
    name: 'New',
    description: 'Updated',
    genres: ['RPG'],
    designPhilosophies: ['Player Agency'],
    expectedUpdatedAt: updatedAt,
  })).resolves.toEqual(updatedProject);
  expect(update.update).toHaveBeenCalledWith(expect.objectContaining({
    name: 'New',
    description: 'Updated',
    genres: ['RPG'],
    design_philosophies: ['Player Agency'],
  }));
  expect(update.eq.mock.calls).toEqual([['id', projectId], ['updated_at', updatedAt]]);
  expect(update.select).toHaveBeenCalledWith('*');
});

it('keeps the existing unsealed UI update path', async () => {
  const { client, update } = clientWithUpdateResult(updatedProject);
  await expect(updateProject(client, projectId, { name: 'New' })).resolves.toEqual(updatedProject);
  expect(update.eq.mock.calls).toEqual([['id', projectId]]);
  expect(update.select).toHaveBeenCalledWith('*');
});
