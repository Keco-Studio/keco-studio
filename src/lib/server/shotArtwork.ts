import { checkBoard } from '@/lib/script-system/shotScript';
import { shotContinuity } from '@/lib/script-system/shotContinuity';
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
  const reference = board.shots.find(s => s.id === referenceId)?.artwork;
  const description = [
    'Wide cinematic pixel art still for a visual novel. Depict the setting and visible action. No text or captions.',
    'Story: ' + board.name,
    'Events on this path: ' + beats.join(' → '),
    reference ? 'Use the reference for architecture, lighting, camera axis, costumes and character identity. Depict the new action in this frame.' : 'Establish the location, lighting and viewpoint for the scene.',
    'This frame: ' + shot.scene + ', ' + shot.speaker + ', ' + shot.line,
    'Direction: ' + brief,
  ].join('\n').slice(0, 3500);
  try {
    const res = await outboundFetch('https://api.pixellab.ai/v1/generate-image-pixflux', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, image_size: { width: 192, height: 112 },
        ...(reference ? { init_image: { type: 'base64', base64: reference.split(',')[1] }, init_image_strength: 350 } : {}) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
    });
    if (!res.ok) return error(502, 'PixelLab could not generate this image (HTTP ' + res.status + ').');
    const data = await res.json() as { image?: { base64?: string } };
    const png = data.image?.base64?.replace(/^data:image\/png;base64,/, '');
    if (!png?.startsWith('iVBORw0KGgo') || png.length > 1499900) return error(502, 'PixelLab returned an invalid image.');
    return Response.json({ artwork: 'data:image/png;base64,' + png });
  } catch { return error(502, 'Could not reach PixelLab. Try generating the shot again.'); }
}
