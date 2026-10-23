import { NextRequest } from 'next/server';

const mockCreatePublicGameDesignSystemVersion = jest.fn();
const mockGetSupabaseServiceRoleClient = jest.fn(() => ({ service: 'role' }));
const withAuth = jest.fn((handler: unknown) => async (request: NextRequest, context: unknown) => (
  (handler as Function)(request, context, {
    supabase: { source: 'viewer' },
    user: { id: '44444444-4444-4444-8444-444444444444' },
  })
));

jest.mock('server-only', () => ({}));
jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: unknown) => withAuth(handler),
}));
jest.mock('@/lib/services/gameDesignSystemService', () => ({
  getGameDesignSystem: jest.fn(),
  getGameDesignSystemDetail: jest.fn(),
}));
jest.mock('@/lib/services/gameDesignSystemWriteService.server', () => {
  class PublicGameDesignSystemVersionError extends Error {
    code: string;
    publicMessage: string;
    ruleIds?: string[];
    conflicts?: Array<{ ruleId: string; reason: string }>;

    constructor(
      code: string,
      options?: { ruleIds?: string[]; conflicts?: Array<{ ruleId: string; reason: string }> },
    ) {
      const publicMessage = code === 'VERSION_RULE_CONFLICT'
        ? 'Version contains incompatible rule changes.'
        : 'Invalid version request.';
      super(publicMessage);
      this.name = 'PublicGameDesignSystemVersionError';
      this.code = code;
      this.publicMessage = publicMessage;
      this.ruleIds = options?.ruleIds;
      this.conflicts = options?.conflicts;
    }
  }

  return {
    createPublicGameDesignSystemVersion: (...args: unknown[]) => mockCreatePublicGameDesignSystemVersion(...args),
    PublicGameDesignSystemVersionError,
  };
});
jest.mock('@/lib/server/supabaseServiceRole', () => ({
  getSupabaseServiceRoleClient: () => mockGetSupabaseServiceRoleClient(),
}));
jest.mock('@/lib/game-design-system/sourceVisibility.server', () => ({
  redactGameDesignSystemDetailForViewer: jest.fn(),
}));

import { PublicGameDesignSystemVersionError } from '@/lib/services/gameDesignSystemWriteService.server';
import { POST } from './route';

const systemId = '11111111-1111-4111-8111-111111111111';
const parentVersionId = '22222222-2222-4222-8222-222222222222';
const idempotencyKey = '33333333-3333-4333-8333-333333333333';

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
    { id: 'fallback-rule', domain: 'fallback', kind: 'constraint', title: 'Fallback rule', statement: 'Define fallback behavior.', appliesWhen: 'No valid action remains.', severity: 'required' },
  ],
  tableGuidance: [],
};

const oversizedRules = {
  ...rules,
  rules: Array.from({ length: 80 }, (_, index) => ({
    id: `rule-${index + 1}`,
    domain: (
      ['player', 'objective', 'action', 'object_state', 'sequence', 'resource_cost', 'resolution_feedback', 'fallback'][index]
      ?? 'player'
    ),
    kind: 'constraint',
    title: `Rule ${index + 1}`,
    statement: 'x'.repeat(800),
    appliesWhen: 'Resolving gameplay.',
    severity: 'required',
  })),
};

function request(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/game-design-systems/${systemId}/versions`, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify(body),
  });
}

describe('game design system version create route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a field error when a structurally valid v2 version write exceeds 64 KiB', async () => {
    const response = await POST(request({
      parentVersionId,
      expectedCurrentVersionId: parentVersionId,
      rules: oversizedRules,
    }) as never, { params: Promise.resolve({ id: systemId }) } as never);

    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('VERSION_REQUEST_INVALID');
    expect(payload.issues.fieldErrors.rules).toEqual([
      expect.stringContaining('Game Design Rule Set exceeds the 64 KiB limit'),
    ]);
    expect(mockCreatePublicGameDesignSystemVersion).not.toHaveBeenCalled();
  });

  it('maps semantic rule conflicts to 409 with their sanitized payload', async () => {
    mockCreatePublicGameDesignSystemVersion.mockRejectedValueOnce(
      new PublicGameDesignSystemVersionError('VERSION_RULE_CONFLICT', {
        conflicts: [{ ruleId: 'player-role', reason: 'Rule domain changed from legacy v1 to player.' }],
      }),
    );

    const response = await POST(request({
      parentVersionId,
      expectedCurrentVersionId: parentVersionId,
      rules,
    }) as never, { params: Promise.resolve({ id: systemId }) } as never);

    await expect(response.json()).resolves.toEqual({
      error: 'Version contains incompatible rule changes.',
      code: 'VERSION_RULE_CONFLICT',
      conflicts: [{ ruleId: 'player-role', reason: 'Rule domain changed from legacy v1 to player.' }],
    });
    expect(response.status).toBe(409);
  });
});
