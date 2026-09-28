import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';

jest.mock('server-only', () => ({}));
jest.mock('next/server', () => ({ after: jest.fn() }));
jest.mock('@/lib/services/authorizationService', () => ({ getUserProjectRole: jest.fn() }));
jest.mock('@/lib/services/dialogueGenerationService', () => ({
  getDialogueGenerationJob: jest.fn(), retryDialogueGenerationJob: jest.fn(),
}));
jest.mock('@/lib/services/gddGenerationService', () => ({
  getGddResourceJob: jest.fn(), retryFailedGddResourceJob: jest.fn(),
}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient: jest.fn() }));

import { after } from 'next/server';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { getDialogueGenerationJob, retryDialogueGenerationJob } from '@/lib/services/dialogueGenerationService';
import { getGddResourceJob, retryFailedGddResourceJob } from '@/lib/services/gddGenerationService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { retryGddDialogueJobTool, retryGddResourceJobTool } from '@/lib/agent/tools/retry-gdd-subjobs';
import { needsConfirmation } from '@/lib/agent/conversation-meta';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const userId = id(1), projectId = id(2), gddJobId = id(3), resourceJobId = id(4), dialogueJobId = id(5);
const service = {} as SupabaseClient;
const ctx = { userId, projectId: id(99), conversationId: id(8), workspace: 'game-design-systems',
  supabase: {} as SupabaseClient } as ToolContext;
const resourceArgs = { projectId, gddJobId, resourceJobId };
const dialogueArgs = { projectId, gddJobId, dialogueJobId };
let resource: Record<string, unknown>;
let dialogue: Record<string, unknown>;

beforeEach(() => {
  jest.clearAllMocks();
  resource = { id: resourceJobId, project_id: projectId, gdd_generation_job_id: gddJobId,
    kind: 'tables', status: 'failed', attempt_count: 3, updated_at: '2026-09-28T00:00:00Z',
    completed_at: '2026-09-28T00:01:00Z', available_at: '2026-09-28T00:00:30Z' };
  dialogue = { id: dialogueJobId, project_id: projectId, gdd_generation_job_id: gddJobId,
    title: 'Chapter 1', status: 'failed', attempt_count: 3, updated_at: '2026-09-28T00:00:00Z' };
  jest.mocked(getUserProjectRole).mockResolvedValue({ role: 'editor', isOwner: false });
  jest.mocked(getSupabaseServiceRoleClient).mockReturnValue(service);
  jest.mocked(getGddResourceJob).mockImplementation(async () => resource as never);
  jest.mocked(getDialogueGenerationJob).mockImplementation(async () => dialogue as never);
  jest.mocked(retryFailedGddResourceJob).mockResolvedValue({ id: resourceJobId, kind: 'tables', status: 'queued' } as never);
  jest.mocked(retryDialogueGenerationJob).mockResolvedValue({ id: dialogueJobId, status: 'queued' } as never);
});

it('requires approval even in Auto mode and exact explicit project targets', () => {
  for (const tool of [retryGddResourceJobTool, retryGddDialogueJobTool]) {
    expect(tool.permissionScope).toBe('explicit-project');
    expect(tool.confirmationPolicy).toBe('always');
    expect(needsConfirmation(tool, { skipConfirmation: true } as never)).toBe(true);
  }
});

it('seals a failed resource retry and wakes work after atomic transition', async () => {
  const prepared = await retryGddResourceJobTool.prepareConfirmation!(resourceArgs, ctx);
  expect(prepared).toMatchObject({ success: true, args: {
    expectedAttemptCount: 3, expectedCompletedAt: resource.completed_at,
    expectedAvailableAt: resource.available_at, expectedKind: 'tables',
  }, preview: { resourceJobId, kind: 'tables' } });
  const result = await retryGddResourceJobTool.execute((prepared as { args: unknown }).args, ctx);
  expect(result).toMatchObject({ success: true, data: { resourceJobId, status: 'queued' } });
  expect(getGddResourceJob).toHaveBeenCalledWith(service,
    { projectId, jobId: gddJobId, resourceJobId });
  expect(retryFailedGddResourceJob).toHaveBeenCalledWith(service, resourceJobId);
  expect(after).toHaveBeenCalledTimes(1);
});

it('requires explicit duplicate-billing acknowledgement for paid map resources', async () => {
  resource.kind = 'maps';
  expect(await retryGddResourceJobTool.prepareConfirmation!(resourceArgs, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('acknowledgeDuplicateBilling') });
  const prepared = await retryGddResourceJobTool.prepareConfirmation!(
    { ...resourceArgs, acknowledgeDuplicateBilling: true }, ctx);
  expect(prepared).toMatchObject({ success: true, preview: { consequence: expect.stringContaining('paid map images') } });
  expect(await retryGddResourceJobTool.execute({ ...(prepared as { args: object }).args,
    acknowledgeDuplicateBilling: false }, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('acknowledgeDuplicateBilling') });
  expect(retryFailedGddResourceJob).not.toHaveBeenCalled();
});

it('rejects changed resource state and changed project access after approval', async () => {
  const prepared = await retryGddResourceJobTool.prepareConfirmation!(resourceArgs, ctx);
  resource.completed_at = '2026-09-28T00:02:00Z';
  expect(await retryGddResourceJobTool.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('changed after approval') });
  resource.completed_at = '2026-09-28T00:01:00Z';
  jest.mocked(getUserProjectRole).mockResolvedValue({ role: 'viewer', isOwner: false });
  expect(await retryGddResourceJobTool.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('editor or admin') });
  expect(retryFailedGddResourceJob).not.toHaveBeenCalled();
});

it('does not replay an approved retry once its resource leaves failed state', async () => {
  const prepared = await retryGddResourceJobTool.prepareConfirmation!(resourceArgs, ctx);
  jest.mocked(retryFailedGddResourceJob).mockImplementation(async () => {
    resource.status = 'queued';
    return { id: resourceJobId, kind: 'tables', status: 'queued' } as never;
  });
  const args = (prepared as { args: unknown }).args;
  expect(await retryGddResourceJobTool.execute(args, ctx)).toMatchObject({ success: true });
  expect(await retryGddResourceJobTool.execute(args, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('Only failed') });
  expect(retryFailedGddResourceJob).toHaveBeenCalledTimes(1);
});

it('checks dialogue parent identity, stale state, and actor at execution', async () => {
  const prepared = await retryGddDialogueJobTool.prepareConfirmation!(dialogueArgs, ctx);
  expect(prepared).toMatchObject({ success: true, args: { expectedAttemptCount: 3 },
    preview: { dialogueJobId, title: 'Chapter 1' } });
  expect(await retryGddDialogueJobTool.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: true, data: { dialogueJobId, status: 'queued' } });
  expect(getDialogueGenerationJob).toHaveBeenCalledWith(service, projectId, gddJobId, dialogueJobId);
  expect(retryDialogueGenerationJob).toHaveBeenCalledWith(service, dialogueJobId, userId);
  dialogue.updated_at = '2026-09-28T00:03:00Z';
  expect(await retryGddDialogueJobTool.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('changed after approval') });
  expect(retryDialogueGenerationJob).toHaveBeenCalledTimes(1);
});

it('does not replay an approved dialogue retry after the first transition', async () => {
  const prepared = await retryGddDialogueJobTool.prepareConfirmation!(dialogueArgs, ctx);
  jest.mocked(retryDialogueGenerationJob).mockImplementation(async () => {
    dialogue.status = 'queued';
    return { id: dialogueJobId, status: 'queued' } as never;
  });
  const args = (prepared as { args: unknown }).args;
  expect(await retryGddDialogueJobTool.execute(args, ctx)).toMatchObject({ success: true });
  expect(await retryGddDialogueJobTool.execute(args, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('Only failed') });
  expect(retryDialogueGenerationJob).toHaveBeenCalledTimes(1);
});
