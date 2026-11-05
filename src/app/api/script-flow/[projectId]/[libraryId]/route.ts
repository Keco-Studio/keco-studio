import { z, ZodError } from 'zod';
import { withAuth } from '@/lib/auth/route-auth';
import { readScriptFlow, saveScriptFlow } from '@/lib/server/scriptFlowEditingService';
type Context = { params: Promise<{ projectId: string; libraryId: string }> };
const scope = z.object({ projectId: z.string().uuid(), libraryId: z.string().uuid() });
export function flowError(error: unknown) {
  const code = (error as { code?: string })?.code;
  const status = code === '42501' ? 403 : code === 'P0002' ? 404 : code === 'PT409' ? 409
    : code === 'TOO_LARGE' ? 413 : code === 'INVALID_REQUEST' || code === '22023' || error instanceof ZodError || error instanceof SyntaxError ? 400 : 500;
  const messages: Record<number, string> = {
    400: 'Invalid flow edit. Check the selected outlet and destination.',
    403: 'Project edit access is required.', 404: 'Script not found.',
    409: 'Script or source changed. Cancel and reopen the flow editor to review the latest version.',
    413: 'Flow request exceeds the 1 MiB limit.', 500: 'Unable to synchronize Script flow.',
  };
  return Response.json({ error: messages[status] }, { status });
}
async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Request body required');
  let length = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 1048576) { await reader.cancel(); throw Object.assign(new Error('Request too large'), { code: 'TOO_LARGE' }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export const GET = withAuth<Context>(async (_request, context, { supabase, user }) => {
  try { const ids = scope.parse(await context.params); return Response.json(await readScriptFlow({ projectId: ids.projectId, libraryId: ids.libraryId, supabase, actorUserId: user.id })); }
  catch (error) { return flowError(error); }
});
export const POST = withAuth<Context>(async (request, context, { supabase, user }) => {
  try { const ids = scope.parse(await context.params); return Response.json(await saveScriptFlow({ projectId: ids.projectId, libraryId: ids.libraryId, supabase, actorUserId: user.id }, await body(request))); }
  catch (error) { return flowError(error); }
});
