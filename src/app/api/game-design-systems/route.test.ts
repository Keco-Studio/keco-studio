import { NextRequest } from 'next/server';

const createGameDesignSystem = jest.fn();
const getSupabaseServiceRoleClient = jest.fn(() => ({ service: 'role' }));
const withAuth = jest.fn((handler: unknown) => async (request: NextRequest) => (
  (handler as Function)(request, undefined, {
    supabase: { source: 'viewer' },
    user: { id: '44444444-4444-4444-8444-444444444444' },
  })
));

jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: unknown) => withAuth(handler),
}));
jest.mock('@/lib/services/gameDesignSystemService', () => ({
  createGameDesignSystem: (...args: unknown[]) => createGameDesignSystem(...args),
  listGameDesignSystemsPage: jest.fn(),
}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({
  getSupabaseServiceRoleClient: () => getSupabaseServiceRoleClient(),
}));

import { POST } from './route';

const rules = {
  schemaVersion: 2,
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitableFor: 'Tactical games',
  rules: [
    { id: 'player-role', domain: 'player', kind: 'constraint', title: 'Player role', statement: 'Define the player role.', appliesWhen: 'Starting an encounter.', severity: 'required' },
    { id: 'objective-rule', domain: 'objective', kind: 'constraint', title: 'Objective rule', statement: 'Define the objective.', appliesWhen: 'Starting an encounter.', severity: 'required' },
    { id: 'action-rule', domain: 'action', kind: 'constraint', title: 'Action rule', statement: 'Define available actions.', appliesWhen: 'Presenting choices.', severity: 'required' },
    { id: 'object-state-rule', domain: 'object_state', kind: 'constraint', title: 'Object state rule', statement: 'Define object state.', appliesWhen: 'Resolving actions.', severity: 'required' },
    { id: 'sequence-rule', domain: 'sequence', kind: 'constraint', title: 'Sequence rule', statement: 'Define resolution sequence.', appliesWhen: 'Resolving actions.', severity: 'required' },
    { id: 'resource-cost-rule', domain: 'resource_cost', kind: 'constraint', title: 'Resource cost rule', statement: 'Define resource costs.', appliesWhen: 'Presenting choices.', severity: 'required' },
    { id: 'resolution-feedback-rule', domain: 'resolution_feedback', kind: 'constraint', title: 'Resolution feedback rule', statement: 'Define resolution feedback.', appliesWhen: 'Completing an action.', severity: 'required' },
    { id: 'fallback-rule', domain: 'fallback', kind: 'constraint', title: 'Fallback rule', statement: 'Define the fallback behavior.', appliesWhen: 'No valid action remains.', severity: 'required' },
  ],
  tableGuidance: [],
};

describe('game design systems create route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a v2 draft through the structured game rule set endpoint', async () => {
    createGameDesignSystem.mockResolvedValueOnce({ id: 'system-1', title: 'Tactical Rules' });

    const response = await POST(new NextRequest('http://localhost/api/game-design-systems', {
      method: 'POST',
      body: JSON.stringify({ title: 'Tactical Rules', rules }),
    }) as never, undefined as never);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ system: { id: 'system-1', title: 'Tactical Rules' } });
    expect(createGameDesignSystem).toHaveBeenCalledWith(
      { service: 'role' },
      '44444444-4444-4444-8444-444444444444',
      expect.objectContaining({ rules, status: 'draft' }),
    );
  });

  it('returns a field error when a v2 draft omits fallback coverage', async () => {
    const response = await POST(new NextRequest('http://localhost/api/game-design-systems', {
      method: 'POST',
      body: JSON.stringify({ title: 'Tactical Rules', rules: { ...rules, rules: rules.rules.slice(0, -1) } }),
    }) as never, undefined as never);

    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Invalid structured game rule set.');
    expect(payload.issues.fieldErrors.rules).toContain('Missing required gameplay rule domain: fallback.');
    expect(createGameDesignSystem).not.toHaveBeenCalled();
  });

  it('rejects a legacy v1 draft at the schema version field', async () => {
    const legacyRules = {
      schemaVersion: 1,
      genres: rules.genres,
      philosophies: rules.philosophies,
      suitableFor: rules.suitableFor,
      rules: [{
        id: 'readable-state',
        kind: 'principle',
        title: 'Readable state',
        statement: 'Expose decision inputs.',
        appliesWhen: 'Presenting choices.',
        severity: 'required',
      }],
      tableGuidance: [],
    };
    const response = await POST(new NextRequest('http://localhost/api/game-design-systems', {
      method: 'POST',
      body: JSON.stringify({ title: 'Legacy Rules', rules: legacyRules }),
    }) as never, undefined as never);

    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.issues.fieldErrors.rules).toContain('New Game Design System drafts require schemaVersion: 2.');
    expect(createGameDesignSystem).not.toHaveBeenCalled();
  });
});
