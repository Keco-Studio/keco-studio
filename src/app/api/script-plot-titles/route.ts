import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { isUuid } from '@/lib/utils/uuid';
import {
  mapScriptPlotTitleError,
  summarizeLibraryPlotTitles,
} from '@/lib/server/scriptPlotTitleService';

export const POST = withAuth(async function POST(request, _context, { supabase }) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: 'INVALID_COMMAND', error: 'Invalid JSON body' }, { status: 400 });
  }
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const libraryId = typeof body.libraryId === 'string' ? body.libraryId : '';
  const chapters = Array.isArray(body.chapters)
    ? body.chapters.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id.trim() : '';
      if (!id) return [];
      const contents = Array.isArray(record.contents)
        ? record.contents.filter((line): line is string => typeof line === 'string')
        : [];
      return [{
        id,
        contents,
        ...(typeof record.title === 'string' ? { title: record.title } : {}),
        ...(typeof record.incomingOption === 'string' ? { incomingOption: record.incomingOption } : {}),
      }];
    })
    : undefined;
  if (!isUuid(projectId) || !isUuid(libraryId)) {
    return NextResponse.json({ code: 'INVALID_COMMAND', error: 'Invalid chapter title request' }, { status: 400 });
  }
  try {
    const result = await summarizeLibraryPlotTitles({
      supabase,
      projectId,
      libraryId,
      ...(chapters && chapters.length > 0 ? { chapters } : {}),
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const mapped = mapScriptPlotTitleError(error);
    if (mapped.status >= 500) {
      console.error('[script-plot-titles] failed', error);
    }
    const clientErrors: Record<string, string> = {
      NOT_FOUND: 'Library not found',
      FORBIDDEN: 'Forbidden',
      INVALID_LIBRARY: 'Library is not a script',
      TITLE_SUMMARY_FAILED: 'Failed to summarize chapter titles',
      SAVE_FAILED: 'Failed to save chapter titles',
    };
    return NextResponse.json(
      {
        code: mapped.code,
        error: clientErrors[mapped.code] ?? 'Failed to summarize chapter titles',
      },
      { status: mapped.status },
    );
  }
});
