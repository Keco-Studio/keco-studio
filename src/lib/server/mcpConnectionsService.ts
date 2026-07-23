import 'server-only';

import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { matchesMcpConnectionId, signMcpConnectionId } from './mcpConnectionId';

export type McpClientKind = 'codex' | 'claude' | 'unknown';

export interface McpConnection {
  id: string;
  client: McpClientKind;
  clientName: 'Codex' | 'Claude Code' | 'MCP Client';
  connectedAt: string;
}

interface InternalConnection {
  authorization_id: string;
  client_name: string | null;
  connected_at: string;
}

export class McpConnectionNotFoundError extends Error {
  constructor() {
    super('MCP connection not found');
    this.name = 'McpConnectionNotFoundError';
  }
}

export function classifyMcpClient(clientName: string | null): {
  client: McpClientKind;
  clientName: McpConnection['clientName'];
} {
  const normalized = clientName?.toLocaleLowerCase('en-US') ?? '';
  if (normalized.includes('codex')) {
    return { client: 'codex', clientName: 'Codex' };
  }
  if (normalized.includes('claude')) {
    return { client: 'claude', clientName: 'Claude Code' };
  }
  return { client: 'unknown', clientName: 'MCP Client' };
}

async function listInternalConnections(userId: string): Promise<InternalConnection[]> {
  const serviceRole = getSupabaseServiceRoleClient();
  const { data, error } = await serviceRole.rpc('list_oauth_mcp_account_connections', {
    p_user_id: userId,
  });
  if (error || !Array.isArray(data)) {
    throw new Error('Unable to load MCP connections');
  }
  return data as InternalConnection[];
}

export async function listMcpConnections(userId: string): Promise<McpConnection[]> {
  const internalConnections = await listInternalConnections(userId);
  return internalConnections
    .map((connection) => ({
      id: signMcpConnectionId(userId, connection.authorization_id),
      ...classifyMcpClient(connection.client_name),
      connectedAt: connection.connected_at,
    }))
    .sort((left, right) => {
      const connectedOrder = right.connectedAt.localeCompare(left.connectedAt);
      return connectedOrder || left.id.localeCompare(right.id);
    });
}

export async function disconnectMcpConnection(
  userId: string,
  connectionId: string
): Promise<void> {
  const candidates = await listInternalConnections(userId);
  let match: InternalConnection | null = null;
  for (const candidate of candidates) {
    if (matchesMcpConnectionId(connectionId, userId, candidate.authorization_id)) {
      match = candidate;
    }
  }
  if (!match) {
    throw new McpConnectionNotFoundError();
  }

  const serviceRole = getSupabaseServiceRoleClient();
  const { data, error } = await serviceRole.rpc('revoke_oauth_mcp_account_connection', {
    p_user_id: userId,
    p_authorization_id: match.authorization_id,
  });
  if (error) {
    throw new Error('Unable to disconnect MCP connection');
  }
  if (data !== true) {
    throw new McpConnectionNotFoundError();
  }
}
