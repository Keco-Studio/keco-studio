import { z } from 'zod';
import { withAuth } from '@/lib/auth/route-auth';
import { generateShotArtwork } from '@/lib/server/shotArtwork';
import { generateShotResponse } from '@/lib/server/shotGeneration';

export const POST = withAuth(async (request, _ctx, { supabase }) => {
  let input;
  try {
    input = z
      .object({
        projectId: z.string().uuid(),
        libraryId: z.string().uuid(),
        board: z.unknown(),
        artworkShotId: z.string().min(1).optional(),
        brief: z.string().max(1000),
      })
      .strict()
      .parse(await request.json());
  } catch {
    return Response.json({ error: 'Invalid shot generation request.' }, { status: 400 });
  }
  const { data: library, error } = await supabase
    .from('libraries')
    .select('id')
    .eq('id', input.libraryId)
    .eq('project_id', input.projectId)
    .eq('document_export_type', 'script')
    .maybeSingle();
  if (error || !library)
    return Response.json({ error: 'You do not have access to this Script.' }, { status: 403 });
  if (input.artworkShotId) return generateShotArtwork(input.board, input.artworkShotId, input.brief, request.signal);
  return generateShotResponse(
    { board: input.board, brief: input.brief },
    request.signal,
  );
});
