const rpc = jest.fn();

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({
  getSupabaseServiceRoleClient: () => ({ rpc }),
}));

import {
  classifyMcpClient,
  disconnectMcpConnection,
  listMcpConnections,
  McpConnectionNotFoundError,
} from '@/lib/server/mcpConnectionsService';

describe('MCP connections server service', () => {
  beforeEach(() => rpc.mockReset());

  it.each([
    ['OpenAI Codex CLI', 'codex', 'Codex'],
    ['my CLAUDE integration', 'claude', 'Claude Code'],
    ['Desktop tool', 'unknown', 'MCP Client'],
    [null, 'unknown', 'MCP Client'],
  ] as const)('classifies %s without exposing its raw name', (raw, client, clientName) => {
    expect(classifyMcpClient(raw)).toEqual({ client, clientName });
  });

  it('returns duplicate client types as separate sanitized, sorted rows', async () => {
    rpc.mockResolvedValueOnce({
      data: [
        { authorization_id: 'auth-b', client_name: 'Codex second', connected_at: '2026-07-24T02:00:00Z' },
        { authorization_id: 'auth-a', client_name: 'Codex first', connected_at: '2026-07-24T03:00:00Z' },
      ],
      error: null,
    });

    const result = await listMcpConnections('user-a');

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.clientName)).toEqual(['Codex', 'Codex']);
    expect(result.map((item) => item.connectedAt)).toEqual([
      '2026-07-24T03:00:00Z',
      '2026-07-24T02:00:00Z',
    ]);
    expect(JSON.stringify(result)).not.toMatch(/auth-[ab]|authorization_id|client_id|session_id/i);
  });

  it('resolves the opaque ID against only current-user candidates before exact revocation', async () => {
    rpc
      .mockResolvedValueOnce({
        data: [
          { authorization_id: 'auth-a', client_name: 'Codex', connected_at: '2026-07-24T03:00:00Z' },
          { authorization_id: 'auth-b', client_name: 'Claude', connected_at: '2026-07-24T02:00:00Z' },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null });
    const [target] = await listMcpConnections('user-a');

    rpc.mockReset();
    rpc
      .mockResolvedValueOnce({
        data: [
          { authorization_id: 'auth-a', client_name: 'Codex', connected_at: '2026-07-24T03:00:00Z' },
          { authorization_id: 'auth-b', client_name: 'Claude', connected_at: '2026-07-24T02:00:00Z' },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null });

    await disconnectMcpConnection('user-a', target.id);
    expect(rpc).toHaveBeenLastCalledWith('revoke_oauth_mcp_account_connection', {
      p_user_id: 'user-a',
      p_authorization_id: 'auth-a',
    });
  });

  it('uses the same not-found result for tampered, foreign, and stale IDs', async () => {
    rpc.mockResolvedValue({
      data: [{ authorization_id: 'auth-a', client_name: 'Codex', connected_at: '2026-07-24T03:00:00Z' }],
      error: null,
    });
    await expect(disconnectMcpConnection('user-a', 'v1.invalid')).rejects.toBeInstanceOf(McpConnectionNotFoundError);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('checks every current-user candidate before revoking the matched grant', async () => {
    rpc.mockResolvedValueOnce({
      data: [
        { authorization_id: 'auth-a', client_name: 'Codex', connected_at: '2026-07-24T03:00:00Z' },
        { authorization_id: 'auth-b', client_name: 'Claude', connected_at: '2026-07-24T02:00:00Z' },
      ],
      error: null,
    });
    const connections = await listMcpConnections('user-a');
    rpc.mockReset();
    rpc
      .mockResolvedValueOnce({
        data: [
          { authorization_id: 'auth-a', client_name: 'Codex', connected_at: '2026-07-24T03:00:00Z' },
          { authorization_id: 'auth-b', client_name: 'Claude', connected_at: '2026-07-24T02:00:00Z' },
          { authorization_id: 'auth-c', client_name: 'Other', connected_at: '2026-07-24T01:00:00Z' },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null });

    await disconnectMcpConnection('user-a', connections[0].id);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith('revoke_oauth_mcp_account_connection', {
      p_user_id: 'user-a',
      p_authorization_id: 'auth-a',
    });
  });
});
