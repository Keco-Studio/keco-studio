import sharp from 'sharp';
import { z } from 'zod';
import { checkBoard } from '@/lib/script-system/shotScript';
import { characterGuidePrompt, characterGuideInput, shotStagingPrompt, shotStagingInput } from '@/lib/script-system/shotPrompts';
import { castDefinitions, castIsReady } from '@/lib/script-system/shotCast';
import { shotContinuity } from '@/lib/script-system/shotContinuity';
import { completeLlm } from '@/lib/agent/llm-client';
import { outboundFetch } from '@/lib/agent/outbound-http';

const stagePlan = z.object({
  background: z.string().trim().min(1).max(5000),
  characters: z.array(z.string().trim().min(1).max(100)).max(12),
});
const bytes = (image: string) => Buffer.from(image.split(',')[1], 'base64');

async function pixelImage(token: string, signal: AbortSignal, description: string, portrait: boolean, reference?: string) {
  const res = await outboundFetch('https://api.pixellab.ai/v1/generate-image-pixflux', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, image_size: portrait ? { width: 48, height: 80 } : { width: 192, height: 112 },
      no_background: portrait,
      ...(reference ? { init_image: { type: 'base64', base64: reference.split(',')[1] }, init_image_strength: 65 } : {}) }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
  });
  if (!res.ok) throw Error('PixelLab returned HTTP ' + res.status);
  const data = await res.json() as { image?: { base64?: string } };
  const png = data.image?.base64?.replace(/^data:image\/png;base64,/, '');
  if (!png?.startsWith('iVBORw0KGgo') || png.length > 1499900) throw Error('Invalid PixelLab image');
  return 'data:image/png;base64,' + png;
}

const error = (status: number, message: string) => Response.json({ error: message }, { status });
const llmOptions = (signal: AbortSignal) => ({ signal, maxCompletionTokens: 1000,
  ...(new URL(process.env.LLM_API_URL || 'https://api.deepseek.com').hostname === 'api.deepseek.com' ? { thinking: 'disabled' as const } : {}) });

export async function prepareCharacters(input: unknown, brief: string, signal: AbortSignal) {
  let board;
  try { board = checkBoard(input); } catch { return error(400, 'Invalid shot script.'); }
  const token = process.env.PIXELLAB_API_KEY;
  if (!token) return error(503, 'Configure PixelLab to create character designs.');
  let guide = board.characterGuide?.trim();
  if (!guide) {
    try {
      guide = (await completeLlm([
        { role: 'system', content: characterGuidePrompt },
        { role: 'user', content: characterGuideInput(board, brief) },
      ], llmOptions(signal))).trim();
    } catch { return error(502, 'Could not draft the character guide.'); }
  }
  if (!guide || guide.length > 4000) return error(400, 'The character guide must contain 1 to 4,000 characters.');
  let definitions;
  try { definitions = castDefinitions(guide); } catch { return error(400, 'Use one unique Name — Appearance per line, or None for an empty cast.'); }
  if (definitions.length > 64) return error(400, 'Use up to 64 characters.');
  const sprites = (board.castSprites ?? []).filter(s => definitions.some(d => d.appearance === s.appearance && d.name === s.name));
  for (const d of definitions) {
    if (sprites.some(s => s.name === d.name)) continue;
    try {
      const image = await pixelImage(token, signal, 'Single isolated transparent full-body pixel-art sprite, neutral standing pose, feet visible, no environment. ' + d.appearance, true);
      sprites.push({ ...d, image });
    } catch {
      return Response.json({ characterGuide: guide, castSprites: sprites, warning: 'Could not prepare ' + d.name + '. Retry to complete the missing designs.' });
    }
  }
  return Response.json({ characterGuide: guide, castSprites: sprites });
}

export async function generateShotArtwork(input: unknown, id: string, brief: string, signal: AbortSignal) {
  let board;
  try { board = checkBoard(input); } catch { return error(400, 'Invalid shot script.'); }
  const shot = board.shots.find(s => s.id === id);
  if (!shot) return error(400, 'Select a shot to illustrate.');
  const token = process.env.PIXELLAB_API_KEY;
  if (!token) return error(503, 'Configure PixelLab on the server to generate scene artwork.');
  const { beats, referenceId } = shotContinuity(board).context(id);
  const reference = board.shots.find(s => s.id === referenceId);
  if (!castIsReady(board)) return error(409, 'Prepare your character designs in Characters first.');
  const guide = board.characterGuide!;
  const sprites = board.castSprites!;
  let plan: z.infer<typeof stagePlan>;
  try {
    const raw = await completeLlm([
      { role: 'system', content: shotStagingPrompt },
      { role: 'user', content: shotStagingInput(board, shot, brief, guide, beats, reference) },
    ], llmOptions(signal));
    plan = stagePlan.parse(JSON.parse(raw.trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/g, '')));
    if (plan.characters.some(name => !sprites.some(s => s.name === name))) throw Error('Unlisted cast member');
  } catch {
    return error(502, 'Could not plan the visible cast. Check the character guide and try again.');
  }
  try {
    const cast = [...new Set(plan.characters)];
    const layers: sharp.OverlayOptions[] = [];
    const width = Math.min(48, Math.floor(184 / Math.max(1, cast.length)));
    for (const [i, name] of cast.entries()) {
      const sprite = sprites.find(s => s.name === name)!;
      const height = Math.round(width * 80 / 48);
      layers.push({ input: await sharp(bytes(sprite.image)).resize(width, height, { kernel: 'nearest' }).png().toBuffer(),
        top: 106 - height, left: Math.round(192 * (i + 0.5) / cast.length - width / 2) });
    }
    const backdrop = await pixelImage(token, signal, 'Empty cinematic pixel art environment, no people. ' + plan.background, false, reference?.backdrop);
    const composite = await sharp(bytes(backdrop)).resize(192, 112).composite(layers).png().toBuffer();
    return Response.json({ characterGuide: guide, castSprites: sprites, backdrop, artwork: 'data:image/png;base64,' + composite.toString('base64') });
  } catch {
    return error(502, 'Could not render the shot with its saved characters. Try again.');
  }
}
