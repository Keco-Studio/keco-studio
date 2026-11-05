import { z } from 'zod';
import { withAuth } from '@/lib/auth/route-auth';
import { generateShotArtwork, prepareCharacters } from '@/lib/server/shotArtwork';
import { generateShotResponse } from '@/lib/server/shotGeneration';
import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import { toScriptImportPlainText } from '@/lib/documents/scriptImportPlainText';

export const POST = withAuth(async (request, _ctx, { supabase }) => {
  let input;
  try {
    input = z
      .object({
        projectId: z.string().uuid(),
        libraryId: z.string().uuid(),
        board: z.unknown(),
        characterName: z.string().trim().min(1).max(100).optional(),
        profilesOnly: z.literal(true).optional(),
        prepareCast: z.literal(true).optional(),
        redrawBackground: z.literal(true).optional(),
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
    .select('id, source_document_id')
    .eq('id', input.libraryId)
    .eq('project_id', input.projectId)
    .eq('document_export_type', 'script')
    .maybeSingle();
  if (error || !library)
    return Response.json({ error: 'You do not have access to this Script.' }, { status: 403 });
  if (input.prepareCast) {
    let sourceText: string | undefined;
    if (library.source_document_id) {
      const source = await documentStateGateway.read(supabase, library.source_document_id);
      if (source.projectId !== input.projectId) return Response.json({ error: 'Source project mismatch.' }, { status: 403 });
      sourceText = toScriptImportPlainText(source.markdown);
      if (sourceText.length > 60000) return Response.json({ error: 'Source document exceeds the character extraction limit.' }, { status: 400 });
    }
    return prepareCharacters(input.board, input.brief, request.signal, input.characterName, input.profilesOnly, sourceText);
  }
  if (input.artworkShotId) return generateShotArtwork(input.board, input.artworkShotId, input.brief, request.signal, input.redrawBackground);
  return generateShotResponse(
    { board: input.board, brief: input.brief },
    request.signal,
  );
});
