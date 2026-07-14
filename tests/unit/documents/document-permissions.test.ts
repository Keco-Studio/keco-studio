import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadDocumentPermissions,
} from '@/components/documents/useDocumentPermissions';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function supabaseWithSession(hasSession = true): SupabaseClient {
  return {
    auth: {
      getSession: jest.fn(async () => ({
        data: {
          session: hasSession
            ? { access_token: 'token', user: { id: USER_ID } }
            : null,
        },
        error: null,
      })),
    },
  } as unknown as SupabaseClient;
}

function roleResponse(role: 'admin' | 'editor' | 'viewer' | null, ok = true) {
  return {
    ok,
    json: async () => ({ role, isOwner: role === 'admin' }),
  } as Response;
}

describe('document permission loader', () => {
  it.each([
    ['admin', false],
    ['editor', false],
    ['viewer', true],
  ] as const)('maps %s to readOnly=%s', async (role, readOnly) => {
    const result = await loadDocumentPermissions({
      projectId: PROJECT_ID,
      documentProjectId: PROJECT_ID,
      supabase: supabaseWithSession(),
      fetcher: jest.fn(async () => roleResponse(role)),
    });

    expect(result).toMatchObject({ role, readOnly, userId: USER_ID, error: null });
  });

  it('rejects a document from a different URL project before fetching role', async () => {
    const fetcher = jest.fn();
    const result = await loadDocumentPermissions({
      projectId: PROJECT_ID,
      documentProjectId: '33333333-3333-4333-8333-333333333333',
      supabase: supabaseWithSession(),
      fetcher,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toMatchObject({ role: null, readOnly: true });
    expect(result.error).toMatch(/does not belong/i);
  });

  it.each([
    ['missing role', roleResponse(null), true],
    ['failed response', roleResponse(null, false), true],
    ['missing session', roleResponse('editor'), false],
  ])('rejects %s', async (_label, response, hasSession) => {
    const result = await loadDocumentPermissions({
      projectId: PROJECT_ID,
      documentProjectId: PROJECT_ID,
      supabase: supabaseWithSession(hasSession),
      fetcher: jest.fn(async () => response),
    });

    expect(result.role).toBeNull();
    expect(result.readOnly).toBe(true);
    expect(result.error).toBeTruthy();
  });

  it('gates stale permission results by the current request tuple', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'src/components/documents/useDocumentPermissions.ts'
      ),
      'utf8'
    );

    expect(source).toContain('requestKey');
    expect(source).toMatch(/loaded\.requestKey !== requestKey/);
    expect(source).toMatch(/return loadingState/);
  });
});
