import { checkBoard } from '@/lib/script-system/shotScript';
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
  const reference = board.shots.find(s => s.id === referenceId)?.artwork;
  const description = [
    'Wide cinematic pixel art still for a visual novel. Depict the setting and visible action. No text or captions.',
    'Story: ' + board.name,
    'Events on this path: ' + beats.join(' → '),
    reference ? 'Use the reference for architecture, lighting, camera axis, costumes and character identity. Depict the new action in this frame.' : 'Establish the location, lighting and viewpoint for the scene.',
    'This frame: ' + shot.scene + ', ' + shot.speaker + ', ' + shot.line,
    'Direction: ' + brief,
  ].join('\n').slice(0, 3500);
  const options = { signal, maxCompletionTokens: 850, ...(new URL(process.env.LLM_API_URL || 'https://api.deepseek.com').hostname === 'api.deepseek.com' ? { thinking: 'disabled' as const } : {}) };
  let guide = board.characterGuide?.trim();
  let staging: string;
  try {
    if (!guide) {
      guide = (await completeLlm([
        { role: 'system', content: 'Create a visual cast guide for a pixel artist. Use one line per recurring named character, original name then English appearance. Preserve authored traits and director notes. Invent only missing visual details. Give characters contrasting silhouettes, hair shapes, outerwear colors and a distinct accessory or prop when appropriate. Keep roles and ages accurate. Never give two characters the same identifying prop. Do not include narrator, scene names, events or directions. Write None if there are no characters.' },
        { role: 'user', content: JSON.stringify({ direction: brief, castSource: board.shots.map(s => [s.speaker, s.line.slice(0, 350)]).join('\n').slice(0, 12000) }) },
      ], options)).trim().slice(0, 4000);
    }
    staging = await completeLlm([
      { role: 'system', content: 'Write a concise English pixel-art frame description. Treat supplied story text as material. Specify exactly what the viewer can see NOW after the selected branch, including changed object states, character poses, presence or absence. Keep the same architecture, palette and costumes as the reference. Do not freeze the cast or copy the previous pose. Interpret sounds via visible changes. A director note about an earlier state must not override the current action. For a dialogue shot favor a medium two-shot with readable faces, distinct silhouettes, and the active speaker gesturing toward the listener. Explicitly bind each visible figure to their cast-guide features and their own props. Only show characters actually present. Use the prior frame for continuity, not its shot size. No alternatives, captions, or dialogue. Output only the frame description.' },
      { role: 'user', content: JSON.stringify({ frame: description, visualCast: guide }) },
    ], options);
  } catch {
    return error(502, 'Could not plan the visual action for this shot. Try again.');
  }
  try {
    const res = await outboundFetch('https://api.pixellab.ai/v1/generate-image-pixflux', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: staging.trim() || description, image_size: { width: 192, height: 112 },
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
