jest.mock('server-only', () => ({}));

import { matchesMcpConnectionId, signMcpConnectionId } from '@/lib/server/mcpConnectionId';

describe('MCP connection opaque IDs', () => {
  it('is deterministic, versioned, user-bound, and contains no source identifiers', () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const authorizationId = 'private-authorization-id';
    const first = signMcpConnectionId(userId, authorizationId);

    expect(first).toBe(signMcpConnectionId(userId, authorizationId));
    expect(first).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
    expect(first).not.toContain(userId);
    expect(first).not.toContain(authorizationId);
    expect(matchesMcpConnectionId(first, userId, authorizationId)).toBe(true);
  });

  it('rejects another user, another grant, tampering, and malformed input', () => {
    const id = signMcpConnectionId('user-a', 'grant-a');
    expect(matchesMcpConnectionId(id, 'user-b', 'grant-a')).toBe(false);
    expect(matchesMcpConnectionId(id, 'user-a', 'grant-b')).toBe(false);
    expect(matchesMcpConnectionId(`${id.slice(0, -1)}A`, 'user-a', 'grant-a')).toBe(false);
    expect(matchesMcpConnectionId('v2.invalid', 'user-a', 'grant-a')).toBe(false);
    expect(matchesMcpConnectionId('grant-a', 'user-a', 'grant-a')).toBe(false);
  });
});
