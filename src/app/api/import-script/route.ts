import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/createSupabaseServerClient';
import { importStoryDocument } from '@/lib/services/scriptImportService';
import { resolveStoryForImport } from '@/lib/services/scriptConversionService';
import type { ImportProgressEvent } from '@/lib/story-ir/schema';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const maxDuration = 300;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['txt', 'md']);

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const supabase = authHeader
    ? createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : createSupabaseServerClient(request);

  const { data: { user }, error: authError } = authHeader
    ? await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    : await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Please sign in to continue' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const projectId = String(formData.get('projectId') ?? '').trim();
  const folderId = String(formData.get('folderId') ?? '').trim();
  const libraryName = String(formData.get('libraryName') ?? '').trim();
  const file = formData.get('file');

  if (!projectId || !isUuid(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }
  if (!folderId || !isUuid(folderId)) {
    return NextResponse.json({ error: 'Invalid folderId' }, { status: 400 });
  }
  if (!libraryName) {
    return NextResponse.json({ error: 'Library name is required' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'File is required' }, { status: 400 });
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: 'File must be .txt or .md' }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File exceeds 10 MB limit' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const conversionController = new AbortController();
  let streamClosed = false;
  const abortFromRequest = () => conversionController.abort(request.signal.reason);
  if (request.signal.aborted) {
    abortFromRequest();
  } else {
    request.signal.addEventListener('abort', abortFromRequest, { once: true });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (record: unknown) => {
        if (streamClosed || conversionController.signal.aborted) return false;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(record)}\n`));
          return true;
        } catch {
          streamClosed = true;
          conversionController.abort(new DOMException('Import response stream closed', 'AbortError'));
          return false;
        }
      };
      void (async () => {
        try {
          const fileContent = await file.text();
          const resolved = await resolveStoryForImport(fileContent, {
            sourceId: `modal:${crypto.randomUUID()}`,
            signal: conversionController.signal,
            onProgress: (progress: ImportProgressEvent) => send({ type: 'progress', progress }),
          });
          if (conversionController.signal.aborted) return;
          send({
            type: 'progress',
            progress: { phase: 'table_compile', message: 'Compiling script table' },
          });
          send({
            type: 'progress',
            progress: { phase: 'database_write', message: 'Writing script library' },
          });
          const result = await importStoryDocument(supabase, {
            userId: user.id,
            projectId,
            folderId,
            libraryName,
            document: resolved.document,
            fileName: file.name,
          });
          send({ type: 'result', result });
        } catch (error) {
          if (!conversionController.signal.aborted) {
            send({ type: 'error', error: safeErrorMessage(error) });
          }
        } finally {
          request.signal.removeEventListener('abort', abortFromRequest);
          if (!streamClosed) {
            streamClosed = true;
            try {
              controller.close();
            } catch {
              // The consumer may have cancelled between the state check and close.
            }
          }
        }
      })();
    },
    cancel(reason) {
      streamClosed = true;
      conversionController.abort(reason);
      request.signal.removeEventListener('abort', abortFromRequest);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String(error.message)
      : 'Import failed';
  return message.slice(0, 1000);
}
