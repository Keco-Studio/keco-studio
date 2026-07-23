import { NextRequest } from 'next/server';

const listMcpConnections = jest.fn();
const disconnectMcpConnection = jest.fn();
let authenticated = true;

jest.mock('server-only', () => ({}));
jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: (...args: any[]) => Promise<Response>, options: any) =>
    (request: NextRequest, context: unknown) => authenticated
      ? handler(request, context, { supabase: {}, user: { id: 'current-user' } })
      : options.unauthorizedResponse(),
}));
jest.mock('@/lib/server/mcpConnectionsService', () => {
  class McpConnectionNotFoundError extends Error {}
  return {
    listMcpConnections: (...args: unknown[]) => listMcpConnections(...args),
    disconnectMcpConnection: (...args: unknown[]) => disconnectMcpConnection(...args),
    McpConnectionNotFoundError,
  };
});

import { GET } from '@/app/api/mcp/connections/route';
import { DELETE } from '@/app/api/mcp/connections/[connectionId]/route';
import { McpConnectionNotFoundError } from '@/lib/server/mcpConnectionsService';

const baseUrl = 'https://keco.example';
const connectionId = 'v1.opaque';

function getRequest() {
  return new NextRequest(baseUrl + '/api/mcp/connections');
}

function deleteRequest(origin = baseUrl) {
  return new NextRequest(baseUrl + '/api/mcp/connections/' + connectionId, {
    method: 'DELETE',
    headers: { origin, 'sec-fetch-site': origin === baseUrl ? 'same-origin' : 'cross-site' },
  });
}

function remove(request = deleteRequest()) {
  return DELETE(request, { params: Promise.resolve({ connectionId }) });
}

describe('MCP connections API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authenticated = true;
  });

  it('returns only the sanitized current-user list with private no-store caching', async () => {
    listMcpConnections.mockResolvedValue([{
      id: connectionId, client: 'codex', clientName: 'Codex', connectedAt: '2026-07-24T03:00:00Z',
    }]);

    const response = await GET(getRequest(), undefined);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body).toEqual({ connections: [{
      id: connectionId, client: 'codex', clientName: 'Codex', connectedAt: '2026-07-24T03:00:00Z',
    }] });
    expect(JSON.stringify(body)).not.toMatch(/clientId|sessionId|authorizationId|accessToken|refreshToken|secret/i);
    expect(listMcpConnections).toHaveBeenCalledWith('current-user');
  });

  it('requires browser authentication for both endpoints', async () => {
    authenticated = false;
    const getResponse = await GET(getRequest(), undefined);
    const deleteResponse = await remove();

    expect(getResponse.status).toBe(401);
    expect(deleteResponse.status).toBe(401);
    expect(getResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(deleteResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(listMcpConnections).not.toHaveBeenCalled();
    expect(disconnectMcpConnection).not.toHaveBeenCalled();
  });

  it('rejects cross-origin deletion before service access', async () => {
    const response = await remove(deleteRequest('https://attacker.example'));
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(disconnectMcpConnection).not.toHaveBeenCalled();
  });

  it('disconnects only the selected opaque ID', async () => {
    disconnectMcpConnection.mockResolvedValue(undefined);
    const response = await remove();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(disconnectMcpConnection).toHaveBeenCalledWith('current-user', connectionId);
  });

  it('returns the same generic 404 for absent, foreign, tampered, or stale IDs', async () => {
    disconnectMcpConnection.mockRejectedValue(new McpConnectionNotFoundError());
    const response = await remove();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'MCP connection not found' });
  });

  it('does not expose internal service failures in responses or logs', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    listMcpConnections.mockRejectedValue(new Error('authorization_id=private database detail'));
    disconnectMcpConnection.mockRejectedValue(new Error('session_id=private database detail'));

    const getResponse = await GET(getRequest(), undefined);
    const deleteResponse = await remove();

    expect(await getResponse.json()).toEqual({ error: 'Unable to load MCP connections' });
    expect(await deleteResponse.json()).toEqual({ error: 'Unable to disconnect MCP connection' });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(/authorization_id|session_id|private database detail/i);
    errorSpy.mockRestore();
  });
});
