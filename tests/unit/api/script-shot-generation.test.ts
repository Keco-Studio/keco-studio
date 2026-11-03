import { example } from '@/lib/script-system/shotScript';
import { completeLlm } from '@/lib/agent/llm-client';
import { outboundFetch } from '@/lib/agent/outbound-http';
import { POST } from '@/app/api/script-shot-generation/route';
jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: unknown) => handler,
}));
jest.mock('@/lib/agent/llm-client', () => ({ completeLlm: jest.fn() }));
jest.mock('@/lib/agent/outbound-http', () => ({ outboundFetch: jest.fn() }));
const id = '11111111-1111-4111-8111-111111111111';
async function run(allowed = true, extra: Record<string, unknown> = {}) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: allowed ? { id } : null }),
  };
  return (POST as unknown as (...args: unknown[]) => Promise<Response>)(
    new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        projectId: id,
        libraryId: id,
        board: example,
        brief: '慢速推进',
        ...extra,
      }),
    }),
    {},
    { supabase: { from: () => query } },
  );
}
test('AI controls direction without changing choices or dialogue, regardless of result order', async () => {
  jest
    .mocked(completeLlm)
    .mockResolvedValue(
      JSON.stringify({
        shots: example.shots
          .map((s) => ({
            id: s.id,
            seconds: 6,
            movement: '右摇',
            tags: ['暗场'],
          }))
          .reverse(),
      }),
    );
  const res = await run();
  expect(res.status).toBe(200);
  expect((await res.json()).board.shots).toEqual(
    example.shots.map((s) => ({
      ...s,
      seconds: 6,
      movement: '右摇',
      tags: ['暗场'],
    })),
  );
});
test('rejects incomplete generation and does not invoke the provider for inaccessible scripts', async () => {
  jest.mocked(completeLlm).mockClear().mockResolvedValue('{"shots":[]}');
  expect((await run(false)).status).toBe(403);
  expect(completeLlm).not.toHaveBeenCalled();
  expect((await run()).status).toBe(502);
});

test('drafts text without images, then redraws only the requested character', async () => {
  const guide = 'Lin — navy coat\nYu — yellow raincoat';
  jest.mocked(completeLlm).mockResolvedValue(guide);
  const draft = await run(true, {prepareCast:true, profilesOnly:true});
  expect(await draft.json()).toEqual({characterGuide:guide, castSprites:[]});
  expect(outboundFetch).not.toHaveBeenCalled();
  const original = process.env.PIXELLAB_API_KEY;
  process.env.PIXELLAB_API_KEY = 'test';
  try {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const castSprites = guide.split('\n').map(appearance => ({name:appearance.split(' — ')[0], appearance, image:png}));
    (outboundFetch as jest.Mock).mockResolvedValue({ok:true,json:async()=>({image:{base64:'iVBORw0KGgoA'}})});
    const result = await run(true, {prepareCast:true, characterName:'Lin', board:{...example, characterGuide:guide, castSprites}});
    const {castSprites: actual} = await result.json();
    expect(outboundFetch).toHaveBeenCalledTimes(1);
    expect(actual).toContainEqual(castSprites[1]);
    expect(actual).toContainEqual({...castSprites[0], image:'data:image/png;base64,iVBORw0KGgoA'});
  } finally {
    if(original===undefined) delete process.env.PIXELLAB_API_KEY;
    else process.env.PIXELLAB_API_KEY=original;
  }
});
