import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withAuth } from '@/lib/auth/route-auth';
import { suggestSimulationFieldMappings } from '@/lib/server/simulationFieldMappingService';
import type { StudioColumnDefinition } from '@/lib/simulation/types';

export const maxDuration = 60;

const Body = z.object({
  role: z.enum(['characters', 'skills', 'level', 'skillc']),
  columns: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    label: z.string().trim().min(1).max(200),
    valueType: z.enum(['string', 'number', 'boolean', 'enum', 'tag', 'other']).optional(),
  }).strict()).max(200),
}).strict();

function mappingErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('LLM_API_KEY')) return 'llm_not_configured';
  if (message.includes('fetch failed')) return 'llm_unreachable';
  if (message.includes('LLM request failed')) return 'llm_upstream_error';
  if (error instanceof SyntaxError
    || message.includes('required tool')
    || message.includes('valid JSON')) {
    return 'llm_invalid_response';
  }
  return 'llm_error';
}

export const POST = withAuth(async function POST(request) {
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: 'Invalid field mapping request' }, { status: 400 });
  }

  try {
    const columns: StudioColumnDefinition[] = body.data.columns.map((column) => ({
      id: column.id!,
      label: column.label!,
      valueType: column.valueType,
    }));
    const mappings = await suggestSimulationFieldMappings(body.data.role!, columns);
    return NextResponse.json({ mappings });
  } catch (error) {
    const code = mappingErrorCode(error);
    const name = error instanceof Error ? error.name : 'UnknownError';
    console.error(`[POST /api/simulation/field-mapping] AI mapping failed code=${code} name=${name}`);
    return NextResponse.json({ error: 'AI field mapping failed', code }, { status: 502 });
  }
}, {
  unauthorizedResponse: () =>
    NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
});
