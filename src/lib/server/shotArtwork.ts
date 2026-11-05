import sharp from 'sharp';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { checkBoard } from '@/lib/script-system/shotScript';
import { characterGuidePrompt, characterExtractionPrompt, characterPortraitPrompt, characterGuideInput, shotStagingPrompt, shotStagingInput } from '@/lib/script-system/shotPrompts';
import { readScriptCharacterProfiles } from '@/lib/script-system/scriptCharacterProfiles';
import { castDefinitions, castIsReady } from '@/lib/script-system/shotCast';
import { shotContinuity } from '@/lib/script-system/shotContinuity';
import { completeLlm } from '@/lib/agent/llm-client';
import { outboundFetch } from '@/lib/agent/outbound-http';

const stagePlan = z.object({
  background: z.string().trim().min(1).max(5000),
  reuseBackdrop: z.boolean().optional(),
  characters: z.array(z.string().trim().min(1).max(100)).max(12),
});
const bytes = (image: string) => Buffer.from(image.split(',')[1], 'base64');

async function pixelImage(token: string, signal: AbortSignal, description: string, portrait: boolean, reference?: string) {
  const body = JSON.stringify({ description, image_size: portrait ? { width: 48, height: 80 } : { width: 192, height: 112 },
    no_background: portrait,
    ...(reference ? { init_image: { type: 'base64', base64: reference.split(',')[1] }, init_image_strength: 65 } : {}) });
  const request = () => outboundFetch('https://api.pixellab.ai/v1/generate-image-pixflux', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body, signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
  });
  let res;
  try {
    res = await request();
  } catch (error) {
    const cause = (error as {cause?: {code?: string}})?.cause?.code;
    if (signal.aborted || !['UND_ERR_CONNECT_TIMEOUT', 'ECONNREFUSED', 'ETIMEDOUT'].includes(cause ?? '')) throw error;
    // Connection failed before PixelLab accepted the request.
    await delay(500, undefined, { signal });
    res = await request();
  }
  if (res.status === 503 && !res.headers.get('retry-after')) {
    await res.body?.cancel();
    await delay(1000, undefined, { signal });
    res = await request();
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw Error('PixelLab returned HTTP ' + res.status);
  }
  const data = await res.json() as { image?: { base64?: string } };
  const png = data.image?.base64?.replace(/^data:image\/png;base64,/, '');
  if (!png?.startsWith('iVBORw0KGgo') || png.length > 1499900) throw Error('Invalid PixelLab image');
  return 'data:image/png;base64,' + png;
}

const error = (status: number, message: string) => Response.json({ error: message }, { status });
const llmOptions = (signal: AbortSignal) => ({ signal, maxCompletionTokens: 1000,
  ...(new URL(process.env.LLM_API_URL || 'https://api.deepseek.com').hostname === 'api.deepseek.com' ? { thinking: 'disabled' as const } : {}) });

export async function prepareCharacters(input: unknown, brief: string, signal: AbortSignal, characterName?: string, profilesOnly = false, sourceDocument?: string) {
  let board;
  try { board = checkBoard(input); } catch { return error(400, 'Invalid shot script.'); }
  const token = process.env.PIXELLAB_API_KEY;

  let guide = board.characterGuide?.trim();
  if (!guide || profilesOnly) {
    try {
      guide = (await completeLlm([
        { role: 'system', content: profilesOnly ? characterExtractionPrompt : characterGuidePrompt },
        { role: 'user', content: characterGuideInput(board, brief, sourceDocument) },
      ], { ...llmOptions(signal), maxCompletionTokens: profilesOnly ? 3000 : 1000 })).trim();
    } catch { return error(502, 'Could not draft the character guide.'); }
  }
  if (!guide || guide.length > 4000) return error(400, 'The character guide must contain 1 to 4,000 characters.');
  let definitions;
  try { definitions = castDefinitions(guide); } catch { return error(400, 'Use one unique Name — Appearance per line, or None for an empty cast.'); }
  if (profilesOnly && sourceDocument) {
    // Author-written descriptions are authoritative, even if the model abbreviated them.
    const explicit = readScriptCharacterProfiles(sourceDocument);
    const speakers = [...new Set(board.shots.map(shot => shot.speaker.trim()).filter(name =>
      name && !/^(narrator|environment|speaker|\u65c1\u767d|\u73af\u5883)$/i.test(name)))];
    definitions = definitions.filter(d => !/^(narrator|environment|speaker|\u65c1\u767d|\u73af\u5883)$/i.test(d.name)
      && (sourceDocument.includes(d.name) || speakers.includes(d.name)));
    for (const profile of explicit) {
      if (!profile.description.trim()) continue;
      const appearance = `${profile.name} - ${profile.description.replace(/\s*\n\s*/g, ' ')}`;
      const index = definitions.findIndex(d => d.name === profile.name);
      if (index >= 0) definitions[index] = { name: profile.name, appearance };
      else definitions.push({ name: profile.name, appearance });
    }
    for (const name of speakers) {
      if (!definitions.some(d => d.name === name)) {
        const unspecified = /\p{Script=Han}/u.test(sourceDocument)
          ? '\u5267\u672c\u4e2d\u7684\u8bf4\u8bdd\u89d2\u8272, \u5176\u4ed6\u8d44\u6599\u672a\u8bf4\u660e.' : 'Dialogue speaker; further details are not specified.';
        definitions.push({ name, appearance: `${name} - ${unspecified}` });
      }
    }
    guide = definitions.map(d => d.appearance).join('\n') || 'None';
    if (guide.length > 4000) return error(400, 'Character descriptions exceed 4,000 characters. Shorten the profiles and retry.');
  }
  if (definitions.length > 64) return error(400, 'Use up to 64 characters.');
  const sprites = (board.castSprites ?? []).filter(s => definitions.some(d => d.appearance === s.appearance && d.name === s.name));
  if (profilesOnly) return Response.json({ characterGuide: guide, castSprites: sprites });
  if (!token) return error(503, 'Configure PixelLab to create character designs.');
  if (characterName && !definitions.some(d => d.name === characterName)) return error(400, 'Unknown character.');
  for (const d of definitions) {
    if (characterName && characterName !== d.name) continue;
    if (!characterName && sprites.some(s => s.name === d.name)) continue;
    try {
      let appearance = d.appearance;
      if (/[^\u0000-\u024f\u2000-\u206f]/.test(appearance)) {
        appearance = (await completeLlm([
          {role: 'system', content: characterPortraitPrompt},
          {role: 'user', content: d.appearance},
        ], llmOptions(signal))).trim();
        if (!appearance || appearance.length > 5000 || /\p{Script=Han}/u.test(appearance)) {
          return error(502, 'Could not translate the character description for artwork. Your profile is preserved.');
        }
      }
      const image = await pixelImage(token, signal, 'Single isolated transparent full-body pixel-art sprite, neutral standing pose, feet visible, no environment. ' + appearance, true);
      const existing = sprites.findIndex(s => s.name === d.name);
      if (existing >= 0) sprites.splice(existing, 1);
      sprites.push({ ...d, image });
    } catch (e) {
      const reason = e instanceof Error && /^PixelLab returned HTTP \d+$/.test(e.message) ? e.message : 'No usable image was received from PixelLab';
      return Response.json({ characterGuide: guide, castSprites: sprites, warning: reason + ' for ' + d.name + '. Retry Generate reference.' });
    }
  }
  return Response.json({ characterGuide: guide, castSprites: sprites });
}

export async function generateShotArtwork(input: unknown, id: string, brief: string, signal: AbortSignal, redrawBackground = false) {
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
  const started = performance.now();
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
  const planDone = performance.now();
  const cast = [...new Set(plan.characters)];
  const layers: sharp.OverlayOptions[] = [];
  const width = Math.min(48, Math.floor(184 / Math.max(1, cast.length)));
  const height = Math.round(width * 80 / 48);
  for (const [i, name] of cast.entries()) {
    const sprite = sprites.find(s => s.name === name)!;
    try {
      const input = await sharp(bytes(sprite.image)).resize(width, height, { kernel: 'nearest' }).png().toBuffer();
      layers.push({ input, top: 106 - height, left: Math.round(192 * (i + 0.5) / cast.length - width / 2) });
    } catch {
      return error(422, 'The reference image for ' + name + ' could not be read. Open Characters and regenerate its reference.');
    }
  }
  const spritesDone = performance.now();
  const reusableBackdrop = !redrawBackground && plan.reuseBackdrop && reference?.backdrop;
  let backdrop;
  try {
    backdrop = reusableBackdrop || await pixelImage(token, signal, 'Empty cinematic pixel art environment, no people. ' + plan.background, false, reference?.backdrop);
  } catch (e) {
    const message = e instanceof Error ? e.message : '';
    const detail = /^PixelLab returned HTTP \d+$/.test(message) ? message
      : message === 'Invalid PixelLab image' ? 'PixelLab returned an invalid background image'
      : 'The background request to PixelLab did not complete';
    return error(502, detail + '. Your character references are saved. Retry scene artwork.');
  }
  const backgroundDone = performance.now();
  try {
    const composite = await sharp(bytes(backdrop)).resize(192, 112).composite(layers).png().toBuffer();
    const timing = [
      ['plan', planDone - started], ['sprites', spritesDone - planDone],
      ['background', backgroundDone - spritesDone], ['compose', performance.now() - backgroundDone],
    ].map(([stage, ms]) => stage + ';dur=' + Math.round(Number(ms))).join(', ');
    return Response.json({ characterGuide: guide, castSprites: sprites, visibleCast: cast, backdrop,
      artwork: 'data:image/png;base64,' + composite.toString('base64') }, {
      headers: { 'Server-Timing': timing, 'X-Backdrop-Source': reusableBackdrop ? 'previous-shot' : 'generated' },
    });
  } catch {
    return error(502, 'The generated background could not be combined with the character layers. Generate the scene artwork again.');
  }
}
