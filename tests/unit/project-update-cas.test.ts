import type { SupabaseClient } from '@supabase/supabase-js';
import { updateProject } from '@/lib/services/projectService';
import { getCurrentUserId, verifyProjectUpdatePermission } from '@/lib/services/authorizationService';

jest.mock('@/lib/services/authorizationService', () => ({
  getCurrentUserId: jest.fn(),
  verifyProjectUpdatePermission: jest.fn(),
}));

const projectId = '11111111-1111-4111-8111-111111111111';
const updatedAt = '2026-09-28T00:00:00.000Z';

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
  jest.mocked(verifyProjectUpdatePermission).mockResolvedValue(undefined);
});

it('rejects a stale project update in the database write', async () => {
  const { client, update } = clientWithUpdateResult(null);
  await expect(updateProject(client, projectId, {
    name: 'New', description: 'Updated', expectedUpdatedAt: updatedAt,
  })).rejects.toThrow('Project changed after approval');
  expect(update.eq.mock.calls).toEqual([['id', projectId], ['updated_at', updatedAt]]);
  expect(update.select).toHaveBeenCalledWith('id');
});

it('keeps the existing unsealed UI update path', async () => {
  const { client, update } = clientWithUpdateResult(null);
  await expect(updateProject(client, projectId, { name: 'New' })).resolves.toBeUndefined();
  expect(update.eq.mock.calls).toEqual([['id', projectId]]);
  expect(update.select).not.toHaveBeenCalled();
});
