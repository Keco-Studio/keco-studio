import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { listMcpConnections } from '@/lib/server/mcpConnectionsService';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

export const GET = withAuth(async function GET(_request, _context, { user }) {
  try {
    const connections = await listMcpConnections(user.id);
    return NextResponse.json({ connections }, { headers: NO_STORE_HEADERS });
  } catch {
    console.error('[GET /api/mcp/connections] Unable to load connections');
    return NextResponse.json(
      { error: 'Unable to load MCP connections' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}, {
  unauthorizedResponse: () => NextResponse.json(
    { error: 'Please sign in to continue' },
    { status: 401, headers: NO_STORE_HEADERS }
  ),
});
