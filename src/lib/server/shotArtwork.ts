import { checkBoard } from '@/lib/script-system/shotScript';
import { characterGuidePrompt, characterGuideInput, shotStagingPrompt, shotStagingInput } from '@/lib/script-system/shotPrompts';
import { shotContinuity } from '@/lib/script-system/shotContinuity';
import { completeLlm } from '@/lib/agent/llm-client';
import { outboundFetch } from '@/lib/agent/outbound-http';

export async function generateShotArtwork(input: unknown, id: string, brief: string, signal: AbortSignal) {
  const error = (status: number, message: string) => Response.json({ error: message }, { status });
  let board;
  try { board = checkBoard(input); } catch { return error(400, 'Invalid shot script.'); }
  const shot = board.shots.find(s => s.id === id);
  if (!shot) return error(400, 'Select a shot to illustrate.');
  const token = process.env.PIXELLAB_API_KEY;
  if (!token) return error(503, 'Configure PixelLab on the server to generate scene artwork.');
  const { beats, referenceId } = shotContinuity(board).context(id);
  const referenceShot = board.shots.find(s => s.id === referenceId);
  const reference = referenceShot?.artwork;
  const options = { signal, maxCompletionTokens: 850, ...(new URL(process.env.LLM_API_URL || 'https://api.deepseek.com').hostname === 'api.deepseek.com' ? { thinking: 'disabled' as const } : {}) };
  let guide = board.characterGuide?.trim();
  let staging: string;
  try {
    if (!guide) {
      guide = (await completeLlm([
        { role: 'system', content: characterGuidePrompt },
        { role: 'user', content: characterGuideInput(board, brief) },
      ], options)).trim().slice(0, 4000);
    }
    staging = await completeLlm([
      { role: 'system', content: shotStagingPrompt },
      { role: 'user', content: shotStagingInput(board, shot, brief, guide, beats, referenceShot) },
    ], options);
    if (!staging.trim()) throw new Error('Empty frame description');
  } catch {
    return error(502, 'Could not plan the visual action for this shot. Try again.');
  }
  try {
    const res = await outboundFetch('https://api.pixellab.ai/v1/generate-image-pixflux', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: staging.trim(), image_size: { width: 192, height: 112 },
        ...(reference ? { init_image: { type: 'base64', base64: reference.split(',')[1] }, init_image_strength: 65 } : {}) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
    });
    if (!res.ok) return error(502, 'PixelLab could not generate this image (HTTP ' + res.status + ').');
    const data = await res.json() as { image?: { base64?: string } };
    const png = data.image?.base64?.replace(/^data:image\/png;base64,/, '');
    if (!png?.startsWith('iVBORw0KGgo') || png.length > 1499900) return error(502, 'PixelLab returned an invalid image.');
    return Response.json({ characterGuide: guide, artwork: 'data:image/png;base64,' + png });
  } catch { return error(502, 'Could not reach PixelLab. Try generating the shot again.'); }
}
