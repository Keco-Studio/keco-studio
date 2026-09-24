import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: jest.fn() }));

import { listConversations } from '@/lib/agent/conversation-store';
import { conversationHistoryLabel } from '@/components/agent/ConversationList';

const USER = 'user-1';
const PROJECT = 'project-1';

function historyRow(id: string, workspace?: string, projectId: string | null = null) {
  return {
    id,
    project_id: projectId,
    projects: projectId ? { name: 'Project Alpha' } : null,
    meta: workspace ? { scope: { level: projectId ? 'project' : 'global', workspace } } : {},
    title: id,
    created_at: '2026-09-24T00:00:00Z',
    updated_at: '2026-09-24T00:00:00Z',
  };
}

function historyClient(rows: ReturnType<typeof historyRow>[]) {
  const query = {
    eq: jest.fn(),
    is: jest.fn(),
    or: jest.fn(),
    order: jest.fn(),
    limit: jest.fn(),
  };
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockResolvedValue({ data: rows, error: null });
  const supabase = {
    from: jest.fn(() => ({ select: jest.fn(() => query) })),
  } as unknown as SupabaseClient;
  return { supabase, query };
}

describe('bounded conversation history', () => {
  it('filters account rows by user and null project, then workspace including legacy Studio', async () => {
    const { supabase, query } = historyClient([
      historyRow('map', 'create-map'),
      historyRow('legacy'),
      historyRow('projects', 'projects'),
    ]);
    const result = await listConversations(supabase, {
      userId: USER, workspace: 'studio', projectId: null,
    });

    expect(query.eq).toHaveBeenCalledWith('user_id', USER);
    expect(query.is).toHaveBeenCalledWith('project_id', null);
    expect(query.or).toHaveBeenCalledWith('meta->scope->>workspace.eq.studio,meta->scope->>workspace.is.null');
    expect(query.limit).toHaveBeenCalledWith(20);
    expect(result.map((item) => item.id)).toEqual(['legacy']);
    expect(result[0]).toMatchObject({ workspace: 'studio', projectId: null });
  });

  it('filters project rows and applies the requested limit after workspace filtering', async () => {
    const { supabase, query } = historyClient([
      historyRow('other-1', 'script', PROJECT),
      historyRow('other-2', 'script', PROJECT),
      historyRow('target-1', 'studio', PROJECT),
      historyRow('target-2', 'studio', PROJECT),
    ]);
    const result = await listConversations(supabase, {
      userId: USER, workspace: 'studio', projectId: PROJECT, limit: 1,
    });

    expect(query.eq).toHaveBeenCalledWith('project_id', PROJECT);
    expect(query.or).toHaveBeenCalledWith('meta->scope->>workspace.eq.studio,meta->scope->>workspace.is.null');
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(result.map((item) => item.id)).toEqual(['target-1']);
    expect(result[0].projectName).toBe('Project Alpha');
  });

  it('caps requested output at 50', async () => {
    const { supabase, query } = historyClient(
      Array.from({ length: 51 }, (_, index) => historyRow(`row-${index}`, 'projects'))
    );
    const result = await listConversations(supabase, {
      userId: USER, workspace: 'projects', projectId: null, limit: 100,
    });
    expect(query.limit).toHaveBeenCalledWith(50);
    expect(query.eq).toHaveBeenCalledWith('meta->scope->>workspace', 'projects');
    expect(result).toHaveLength(50);
  });

  it('labels account rows by workspace and project rows by project name', () => {
    expect(conversationHistoryLabel({ workspace: 'create-map', projectId: null })).toBe('Create Map');
    expect(conversationHistoryLabel({ workspace: 'studio', projectId: PROJECT, projectName: 'Project Alpha' }))
      .toBe('Project Alpha');
  });
});
