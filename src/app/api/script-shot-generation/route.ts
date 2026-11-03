import { z } from 'zod';
import { withAuth } from '@/lib/auth/route-auth';
import { generateShotResponse } from '@/lib/server/shotGeneration';

export const POST = withAuth(async (request, _ctx, { supabase }) => {
  let input;
  try {
    input = z
      .object({
        projectId: z.string().uuid(),
        libraryId: z.string().uuid(),
        board: z.unknown(),
        brief: z.string().max(1000),
      })
      .strict()
      .parse(await request.json());
  } catch {
    return Response.json({ error: '镜头生成请求格式无效。' }, { status: 400 });
  }
  const { data: library, error } = await supabase
    .from('libraries')
    .select('id')
    .eq('id', input.libraryId)
    .eq('project_id', input.projectId)
    .eq('document_export_type', 'script')
    .maybeSingle();
  if (error || !library)
    return Response.json({ error: '无法访问此 Script。' }, { status: 403 });
  return generateShotResponse(
    { board: input.board, brief: input.brief },
    request.signal,
  );
});
