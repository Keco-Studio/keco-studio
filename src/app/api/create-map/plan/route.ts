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
  createMapPlanV3,
  type DirectMapReferenceSelection,
} from '@/lib/server/createMapPlanner';

export const maxDuration = 60;

const ReferenceId = z.string().uuid();
const StyleCopy = z.enum(['color_palette', 'outline', 'detail', 'shading']);

const Body = z.object({
  description: z.string().trim().min(1).max(4_000),
  projectId: z.string().uuid().optional(),
  documentId: z.string().uuid().optional(),
  schemaVersion: z.literal(3).default(3),
  referenceIds: z.array(ReferenceId).max(4).default([]),
  styleReferenceId: ReferenceId.nullable().default(null),
  referenceRoles: z.record(ReferenceId, z.enum(['content', 'layout'])).default({}),
  referenceUsage: z.record(ReferenceId, z.string().trim().min(1).max(240)).default({}),
  styleCopy: z.array(StyleCopy).max(4).default([]),
}).strict().superRefine((value, context) => {
  if (value.documentId && !value.projectId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'projectId is required with documentId', path: ['projectId'] });
  }

  const referenceIds = new Set(value.referenceIds);
  if (referenceIds.size !== value.referenceIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Reference IDs must be unique', path: ['referenceIds'] });
  }
  const hasExactKeys = (record: Record<string, unknown>) => {
    const keys = Object.keys(record);
    return keys.length === referenceIds.size && keys.every((key) => referenceIds.has(key));
  };
  if (!hasExactKeys(value.referenceRoles)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Reference roles must match selected references', path: ['referenceRoles'] });
  }
  if (!hasExactKeys(value.referenceUsage)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Reference usage must match selected references', path: ['referenceUsage'] });
  }
  if (value.styleReferenceId !== null) {
    if (referenceIds.has(value.styleReferenceId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Style reference must not duplicate a content or layout reference', path: ['styleReferenceId'] });
    }
    if (value.styleCopy.length === 0 || new Set(value.styleCopy).size !== value.styleCopy.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Style copy must contain one to four unique values', path: ['styleCopy'] });
    }
  } else if (value.styleCopy.length !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Style copy requires a style reference', path: ['styleCopy'] });
  }
  if ((value.referenceIds.length > 0 || value.styleReferenceId !== null) && !value.projectId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'projectId is required with references', path: ['projectId'] });
  }
});

const RegistryReference = z.object({
  id: ReferenceId,
  project_id: ReferenceId,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

class InvalidReferenceSelectionError extends Error {}

async function loadAuthorizedReferences(
  supabase: Parameters<typeof readCreateMapDocumentSource>[0],
  projectId: string,
  referenceIds: string[],
  styleReferenceId: string | null,
  referenceRoles: Record<string, 'content' | 'layout'>,
  referenceUsage: Record<string, string>,
  styleCopy: Array<z.infer<typeof StyleCopy>>,
): Promise<DirectMapReferenceSelection> {
  const requestedIds = [...referenceIds, ...(styleReferenceId ? [styleReferenceId] : [])];
  if (requestedIds.length === 0) return { references: [], styleReference: null };

  const { data, error } = await supabase.from('map_reference_images')
    .select('id, project_id, sha256')
    .eq('project_id', projectId)
    .in('id', requestedIds);
  if (error) throw error;
  const parsed = z.array(RegistryReference).safeParse(data);
  if (!parsed.success || parsed.data.length !== requestedIds.length) throw new InvalidReferenceSelectionError();
  const byId = new Map(parsed.data.map((row) => [row.id, row]));
  if (byId.size !== requestedIds.length || [...byId.values()].some((row) => row.project_id !== projectId)) {
    throw new InvalidReferenceSelectionError();
  }

  return {
    references: referenceIds.map((assetId) => {
      const row = byId.get(assetId);
      if (!row) throw new InvalidReferenceSelectionError();
      return { assetId, sha256: row.sha256, role: referenceRoles[assetId], usage: referenceUsage[assetId] };
    }),
    styleReference: styleReferenceId === null ? null : (() => {
      const row = byId.get(styleReferenceId);
      if (!row) throw new InvalidReferenceSelectionError();
      return { assetId: styleReferenceId, sha256: row.sha256, copy: styleCopy };
    })(),
  };
}

export const POST = withAuth(async function POST(request, _context, { supabase, user }) {
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'Invalid Create Map request' }, { status: 400 });

  try {
    const source = body.data.documentId
      ? await readCreateMapDocumentSource(supabase, user.id, body.data.projectId!, body.data.documentId)
      : undefined;
    const plan = await createMapPlanV3(
      body.data.description,
      source,
      await loadAuthorizedReferences(
        supabase,
        body.data.projectId ?? '',
        body.data.referenceIds,
        body.data.styleReferenceId,
        body.data.referenceRoles,
        body.data.referenceUsage,
        body.data.styleCopy,
      ),
    );
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
    if (error instanceof InvalidReferenceSelectionError) {
      return NextResponse.json({ error: 'Invalid Create Map reference selection' }, { status: 400 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: 'Map creation requires editor access' }, { status: 403 });
    }
    if (error instanceof CreateMapPlannerError) {
      return NextResponse.json({ error: 'Could not create a valid map plan', code: error.code }, { status: 502 });
    }
    if (error instanceof CreateMapPlannerInputError) {
      return NextResponse.json({ error: 'Map description is required', code: error.code }, { status: 400 });
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
