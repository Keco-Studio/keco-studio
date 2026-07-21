import { NextResponse } from 'next/server';
import {
  buildProjectResourceUrl,
  buildProtectedResourceMetadata,
} from '@/lib/mcp/oauthMetadata';

export function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get('project_id') ?? '';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  try {
    const resource = buildProjectResourceUrl(supabaseUrl, projectId);
    return NextResponse.json(
      buildProtectedResourceMetadata({
        resource,
        authorizationServer: `${supabaseUrl.replace(/\/$/, '')}/auth/v1`,
      }),
      { headers: { 'cache-control': 'public, max-age=300' } }
    );
  } catch {
    return NextResponse.json({ error: 'Invalid MCP project metadata request.' }, { status: 400 });
  }
}
