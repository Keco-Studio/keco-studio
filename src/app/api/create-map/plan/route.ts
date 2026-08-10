import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withAuth } from '@/lib/auth/route-auth';
import { AuthorizationError } from '@/lib/services/authorizationService';
import {
  CreateMapDocumentSourceError,
  readCreateMapDocumentSource,
} from '@/lib/server/createMapDocumentSource';
import {
  CreateMapPlannerError,
  CreateMapPlannerInputError,
  createMapPlanV2,
} from '@/lib/server/createMapPlanner';

export const maxDuration = 60;

const Body = z
  .object({
    description: z.string().trim().min(1).max(4_000),
    projectId: z.string().uuid().optional(),
    documentId: z.string().uuid().optional(),
  })
  .strict()
  .refine((value) => !value.documentId || Boolean(value.projectId), {
    message: 'projectId is required with documentId',
    path: ['projectId'],
  });

export const POST = withAuth(async function POST(request, _context, { supabase, user }) {
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'Invalid Create Map request' }, { status: 400 });

  try {
    const source = body.data.documentId
      ? await readCreateMapDocumentSource(supabase, user.id, body.data.projectId!, body.data.documentId)
      : undefined;
    const plan = await createMapPlanV2(body.data.description, source);
    return NextResponse.json({
      sourceToken: source ? {
        documentId: source.documentId,
        documentUpdatedAt: source.documentUpdatedAt,
        epoch: source.token.epoch,
        revision: source.token.revision,
      } : null,
      plan,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: 'Map creation requires editor access' }, { status: 403 });
    }
    if (error instanceof CreateMapPlannerError) {
      return NextResponse.json({ error: 'Could not create a valid map plan', code: error.code }, { status: 502 });
    }
    if (error instanceof CreateMapPlannerInputError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    if (error instanceof CreateMapDocumentSourceError && error.code === 'document_empty') {
      return NextResponse.json({ error: 'Document is empty', code: error.code }, { status: 400 });
    }
    if (error instanceof CreateMapDocumentSourceError && error.code === 'document_project_mismatch') {
      return NextResponse.json({ error: 'Document does not belong to project', code: error.code }, { status: 403 });
    }
    if (error instanceof CreateMapDocumentSourceError && error.code === 'document_not_found') {
      return NextResponse.json({ error: 'Document not found or not accessible' }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : '';
    const code = message.includes('LLM_API_KEY') ? 'llm_not_configured'
      : message.includes('LLM request failed') ? 'llm_upstream_error'
        : 'map_plan_error';
    console.error(`[POST /api/create-map/plan] failed code=${code} name=${error instanceof Error ? error.name : 'UnknownError'}`);
    return NextResponse.json({ error: 'Failed to create map plan', code }, { status: 502 });
  }
}, {
  unauthorizedResponse: () => NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
});
