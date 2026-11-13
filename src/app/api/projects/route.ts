import { NextResponse, NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/route-auth';
import {
  DESIGN_PHILOSOPHY_PRESETS,
  GAME_GENRE_PRESETS,
  normalizeFoundationTags,
} from '@/lib/projectFoundation';
import { validateName } from '@/lib/utils/nameValidation';
import {
  instantiateProjectTemplate,
  ProjectTemplateInProgressError,
  ProjectTemplateRequestConflictError,
} from '@/lib/project-templates/instantiate.server';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { StorageQuotaError } from '@/lib/server/storageQuota';

type ProjectCreateRpcResult = {
  project?: Record<string, unknown>;
  folder_id?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const templateEnvelopeSchema = z.discriminatedUnion('templateKey', [
  z.object({
    templateKey: z.literal('blank'),
    templateRequestId: z.string().uuid().optional(),
  }).passthrough(),
  z.object({
    templateKey: z.literal('tactical-deckbuilder'),
    templateRequestId: z.string().uuid(),
  }).passthrough(),
]);

export const GET = withAuth(async function GET(
  _request,
  _context,
  { supabase, user }
) {
  // only return projects owned by the current user
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[GET /api/projects] Failed to load projects:', error);
    return NextResponse.json({ error: 'Failed to load projects' }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}, {
  unauthorizedResponse: () =>
    NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
});

export const POST = withAuth(async function POST(
  request: NextRequest,
  _context,
  { supabase, user }
) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name : '';
  const description: string | null = body?.description ?? null;
  const genres = body?.genres ?? [];
  const designPhilosophies = body?.designPhilosophies ?? [];

  let templateEnvelope: z.infer<typeof templateEnvelopeSchema> = { templateKey: 'blank' };
  if (body?.templateKey !== undefined) {
    const parsed = templateEnvelopeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid project template request' }, { status: 400 });
    }
    templateEnvelope = parsed.data;
  }

  const trimmed = name.trim();
  if (!trimmed) {
    return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
  }
  const validationError = validateName(trimmed);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }
  if (!isStringArray(genres) || !isStringArray(designPhilosophies)) {
    return NextResponse.json({ error: 'Foundation tags must be arrays of strings' }, { status: 400 });
  }

  if (templateEnvelope.templateKey === 'tactical-deckbuilder') {
    if (description !== null && typeof description !== 'string') {
      return NextResponse.json({ error: 'Project description must be a string' }, { status: 400 });
    }
    try {
      const created = await instantiateProjectTemplate({
        authClient: supabase,
        serviceClient: getSupabaseServiceRoleClient(),
        userId: user.id,
        requestId: templateEnvelope.templateRequestId,
        templateKey: templateEnvelope.templateKey,
        name: trimmed,
        description: typeof description === 'string' ? description.trim() || null : null,
      });
      return NextResponse.json({
        ...created.project,
        default_folder_id: created.defaultFolderId,
      }, { status: 201 });
    } catch (error) {
      if (error instanceof ProjectTemplateInProgressError) {
        return NextResponse.json({ error: 'Project template creation is already in progress' }, { status: 409 });
      }
      if (error instanceof ProjectTemplateRequestConflictError) {
        return NextResponse.json({ error: 'Project template request conflicts with an earlier request' }, { status: 409 });
      }
      if (error instanceof StorageQuotaError) {
        if (error.code === 'STORAGE_QUOTA_EXCEEDED') {
          return NextResponse.json({ error: 'Storage quota exceeded' }, { status: 409 });
        }
        if (error.code === 'STORAGE_PROJECT_FORBIDDEN') {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
      console.error('[POST /api/projects] Template creation failed:', error);
      return NextResponse.json({ error: 'Failed to create project from template' }, { status: 500 });
    }
  }

  const { data, error } = await supabase.rpc('create_project_with_foundation', {
    p_name: trimmed,
    p_description: description,
    p_genres: normalizeFoundationTags(genres, GAME_GENRE_PRESETS),
    p_design_philosophies: normalizeFoundationTags(designPhilosophies, DESIGN_PHILOSOPHY_PRESETS),
  });

  if (error) {
    console.error('[POST /api/projects] RPC error:', error);
    return NextResponse.json({ error: 'Failed to create project' }, { status: 400 });
  }

  if (!data) {
    console.error('No data returned from RPC');
    return NextResponse.json({ error: 'Project creation failed: no data returned' }, { status: 500 });
  }

  // Handle different return formats:
  // 1. If function returns JSON type, Supabase RPC returns the JSON object directly (not array)
  // 2. If function returns TABLE type, Supabase RPC returns an array
  let result: ProjectCreateRpcResult;

  if (Array.isArray(data)) {
    // TABLE return type - get first element
    if (data.length === 0) {
      return NextResponse.json({ error: 'Project creation failed: empty response' }, { status: 500 });
    }
    const first = data[0];
    if (!isRecord(first)) {
      return NextResponse.json({ error: 'Project creation failed: invalid response format' }, { status: 500 });
    }
    result = first;
  } else if (isRecord(data)) {
    // JSON return type - data is already the result object
    result = data;
  } else if (typeof data === 'string') {
    // JSON string - parse it
    try {
      const parsed: unknown = JSON.parse(data);
      if (!isRecord(parsed)) {
        return NextResponse.json({ error: 'Project creation failed: invalid JSON response' }, { status: 500 });
      }
      result = parsed;
    } catch (e) {
      console.error('Failed to parse JSON string:', e);
      return NextResponse.json({ error: 'Project creation failed: invalid JSON response' }, { status: 500 });
    }
  } else {
    console.error('Unexpected data format:', data);
    return NextResponse.json({ error: 'Project creation failed: invalid response format' }, { status: 500 });
  }

  const project = result.project;
  const folderId = result.folder_id;

  if (!project || typeof project.id !== 'string' || !project.id) {
    console.error('Missing project in result:', result);
    return NextResponse.json({ error: 'Project creation failed: invalid response format' }, { status: 500 });
  }

  if (typeof folderId !== 'string' || !folderId) {
    console.error('Missing folder_id in result:', result);
    return NextResponse.json({ error: 'Project creation failed: missing folder_id' }, { status: 500 });
  }

  return NextResponse.json(
    {
      ...project,
      default_folder_id: folderId,
    },
    { status: 201 }
  );
}, {
  unauthorizedResponse: () =>
    NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
});

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
