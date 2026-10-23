import { NextRequest } from 'next/server';

const getGameDesignSystem = jest.fn();
const copyGameDesignSystem = jest.fn();
const getSupabaseServiceRoleClient = jest.fn(() => ({ service: 'role' }));

class LegacyGameDesignSystemMutationError extends Error {
  code = 'LEGACY_RULE_SET_READ_ONLY' as const;
  publicMessage: string;

  constructor() {
    const publicMessage = 'Legacy schemaVersion: 1 Game Design Systems are read-only and cannot be copied. Author a new schemaVersion: 2 Game Rules Kernel with fresh rule IDs.';
    super(publicMessage);
    this.publicMessage = publicMessage;
  }
}

jest.mock('server-only', () => ({}));
jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: Function) => (request: NextRequest, context: unknown) => handler(request, context, {
    supabase: { source: 'viewer' },
    user: { id: '44444444-4444-4444-8444-444444444444' },
  }),
}));
jest.mock('@/lib/services/gameDesignSystemService', () => ({
  getGameDesignSystem: (...args: unknown[]) => getGameDesignSystem(...args),
  copyGameDesignSystem: (...args: unknown[]) => copyGameDesignSystem(...args),
  LegacyGameDesignSystemMutationError,
}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({
  getSupabaseServiceRoleClient: () => getSupabaseServiceRoleClient(),
}));
jest.mock('@/lib/game-design-system/sourceVisibility.server', () => ({
  redactGameDesignSystemDetailForViewer: jest.fn(),
}));

import { POST as copyRoutePost } from './route';
import { POST as legacyApiPost } from '../route';

const context = { params: Promise.resolve({ id: 'system-1' }) };

describe('legacy Game Design System copy routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getGameDesignSystem.mockResolvedValue({
      id: 'system-1', source: 'user', owner_id: '44444444-4444-4444-8444-444444444444',
    });
    copyGameDesignSystem.mockRejectedValue(new LegacyGameDesignSystemMutationError());
  });

  it.each([
    ['UI copy endpoint', copyRoutePost, 'http://localhost/api/game-design-systems/system-1/copy'],
    ['backward-compatible API endpoint', legacyApiPost, 'http://localhost/api/game-design-systems/system-1'],
  ])('returns actionable legacy guidance from the %s', async (_label, handler, url) => {
    const response = await handler(new NextRequest(url, { method: 'POST' }) as never, context as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: 'LEGACY_RULE_SET_READ_ONLY',
      error: 'Legacy schemaVersion: 1 Game Design Systems are read-only and cannot be copied. Author a new schemaVersion: 2 Game Rules Kernel with fresh rule IDs.',
    });
  });
});
