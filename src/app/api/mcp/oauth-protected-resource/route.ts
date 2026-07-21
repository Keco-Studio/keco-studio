import { NextResponse } from 'next/server';
import {
  buildProjectResourceUrl,
  buildProtectedResourceMetadata,
  InvalidMcpProjectIdError,
  normalizeSupabaseOrigin,
} from '@/lib/mcp/oauthMetadata';

export function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get('project_id') ?? '';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  try {
    // Validate the request's project ID before configuration so malformed IDs
    // retain their 400 response even when deployment configuration is broken.
    const resource = buildProjectResourceUrl(supabaseUrl, projectId);
    const supabaseOrigin = normalizeSupabaseOrigin(supabaseUrl);
    return NextResponse.json(
      buildProtectedResourceMetadata({
        resource,
        authorizationServer: `${supabaseOrigin}/auth/v1`,
      }),
      { headers: { 'cache-control': 'public, max-age=300' } }
    );
  } catch (error) {
    if (error instanceof InvalidMcpProjectIdError) {
      return NextResponse.json({ error: 'Invalid MCP project metadata request.' }, { status: 400 });
    }
    console.error('[GET /api/mcp/oauth-protected-resource] Invalid metadata configuration');
    return NextResponse.json({ error: 'MCP metadata is not configured.' }, { status: 500 });
  }
}
