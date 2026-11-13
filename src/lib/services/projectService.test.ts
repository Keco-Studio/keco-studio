import type { SupabaseClient } from '@supabase/supabase-js';

const verifyProjectCreation = jest.fn();

jest.mock('./authorizationService', () => ({
  verifyProjectCreation: (...args: unknown[]) => verifyProjectCreation(...args),
  verifyProjectAccess: jest.fn(),
  verifyProjectUpdatePermission: jest.fn(),
  getCurrentUserId: jest.fn(),
}));

import { createBlankProject, createProject } from './projectService';

describe('createBlankProject', () => {
  beforeEach(() => verifyProjectCreation.mockReset().mockResolvedValue(undefined));

  it('keeps template intent out of the existing blank-project RPC', async () => {
    const project = {
      id: '11111111-1111-4111-8111-111111111111',
      owner_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Tactics',
      description: 'Starter',
      genres: [],
      design_philosophies: [],
      created_at: '2026-11-13T00:00:00.000Z',
      updated_at: '2026-11-13T00:00:00.000Z',
    };
    const rpc = jest.fn().mockResolvedValue({
      data: { project, folder_id: '22222222-2222-4222-8222-222222222222' },
      error: null,
    });
    const supabase = { rpc } as unknown as SupabaseClient;

    await expect(createBlankProject(supabase, {
      name: ' Tactics ',
      description: ' Starter ',
      templateKey: 'tactical-deckbuilder',
      templateRequestId: '33333333-3333-4333-8333-333333333333',
    })).resolves.toEqual({
      project,
      defaultFolderId: '22222222-2222-4222-8222-222222222222',
    });
    expect(rpc).toHaveBeenCalledWith('create_project_with_foundation', {
      p_name: 'Tactics',
      p_description: 'Starter',
      p_genres: [],
      p_design_philosophies: [],
    });
  });
});

describe('createProject template branch', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts an authenticated tactical request and converts the API result', async () => {
    const getSession = jest.fn().mockResolvedValue({
      data: { session: { access_token: 'template-token' } },
      error: null,
    });
    const supabase = { auth: { getSession }, rpc: jest.fn() } as unknown as SupabaseClient;
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      id: '11111111-1111-4111-8111-111111111111',
      owner_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Tactics',
      description: 'A starter.',
      genres: [],
      design_philosophies: [],
      created_at: '2026-11-13T00:00:00.000Z',
      updated_at: '2026-11-13T00:00:00.000Z',
      default_folder_id: '22222222-2222-4222-8222-222222222222',
    }), { status: 201, headers: { 'content-type': 'application/json' } })) as typeof fetch;

    await expect(createProject(supabase, {
      name: ' Tactics ',
      description: ' A starter. ',
      templateKey: 'tactical-deckbuilder',
      templateRequestId: '33333333-3333-4333-8333-333333333333',
    })).resolves.toMatchObject({
      project: { id: '11111111-1111-4111-8111-111111111111', name: 'Tactics' },
      defaultFolderId: '22222222-2222-4222-8222-222222222222',
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/projects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer template-token',
      },
      body: JSON.stringify({
        name: 'Tactics',
        description: 'A starter.',
        templateKey: 'tactical-deckbuilder',
        templateRequestId: '33333333-3333-4333-8333-333333333333',
      }),
    });
    expect((supabase as unknown as { rpc: jest.Mock }).rpc).not.toHaveBeenCalled();
  });

  it('surfaces a safe tactical API error', async () => {
    const supabase = {
      auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null }) },
      rpc: jest.fn(),
    } as unknown as SupabaseClient;
    global.fetch = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Project template creation is already in progress' }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch;

    await expect(createProject(supabase, {
      name: 'Tactics',
      templateKey: 'tactical-deckbuilder',
      templateRequestId: '33333333-3333-4333-8333-333333333333',
    })).rejects.toThrow('Project template creation is already in progress');
  });
});
