import { NextRequest, NextResponse } from 'next/server';
import { withAuth, type AuthedRequest } from '@/lib/auth/route-auth';
import { isSameOriginMutation } from '@/lib/auth/sameOriginMutation';
import {
  disconnectMcpConnection,
  McpConnectionNotFoundError,
} from '@/lib/server/mcpConnectionsService';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

const deleteHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
  { user }: AuthedRequest
) => {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json(
      { error: 'Request not allowed' },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  const { connectionId } = await params;
  try {
    await disconnectMcpConnection(user.id, connectionId);
    return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof McpConnectionNotFoundError) {
      return NextResponse.json(
        { error: 'MCP connection not found' },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    console.error('[DELETE /api/mcp/connections] Unable to disconnect connection');
    return NextResponse.json(
      { error: 'Unable to disconnect MCP connection' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
};

export const DELETE = withAuth(deleteHandler, {
  unauthorizedResponse: () => NextResponse.json(
    { error: 'Please sign in to continue' },
    { status: 401, headers: NO_STORE_HEADERS }
  ),
});
