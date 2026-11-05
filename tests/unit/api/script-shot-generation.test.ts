import { example } from '@/lib/script-system/shotScript';
import { completeLlm } from '@/lib/agent/llm-client';
import { outboundFetch } from '@/lib/agent/outbound-http';
import { POST } from '@/app/api/script-shot-generation/route';
import { documentStateGateway } from '@/lib/documents/documentStateGateway';
jest.mock('@/lib/documents/documentStateGateway', () => ({ documentStateGateway: { read: jest.fn() } }));
jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: unknown) => handler,
}));
jest.mock('@/lib/agent/llm-client', () => ({ completeLlm: jest.fn() }));
jest.mock('@/lib/agent/outbound-http', () => ({ outboundFetch: jest.fn() }));
const id = '11111111-1111-4111-8111-111111111111';
async function run(allowed = true, extra: Record<string, unknown> = {}, sourceId?: string) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: allowed ? { id, source_document_id: sourceId } : null }),
  };
  return (POST as unknown as (...args: unknown[]) => Promise<Response>)(
    new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        projectId: id,
        libraryId: id,
        board: example,
        brief: '\u6162\u901f\u63a8\u8fdb',
        ...extra,
      }),
    }),
    {},
    { supabase: { from: () => query } },
  );
}

test('refreshes existing profiles using source descriptions and preserves explicit author details', async () => {
  const source = '**Character - Lin**\n*Older lighthouse keeper, red raincoat, carries a copper lamp.*\n\n**Lighthouse**\nLin: Welcome.';
  jest.mocked(documentStateGateway.read).mockResolvedValue({ projectId: id, markdown: source } as never);
  jest.mocked(completeLlm).mockClear().mockResolvedValue('Lin - A keeper');
  const res = await run(true, { prepareCast: true, profilesOnly: true, board: { ...example,
    shots: example.shots.map(shot => ({ ...shot, speaker: 'Lin' })), characterGuide: 'Lin - Old cached description' } }, id);
  expect(res.status).toBe(200);
  expect((await res.json()).characterGuide).toBe('Lin - Older lighthouse keeper, red raincoat, carries a copper lamp.');
  expect(completeLlm).toHaveBeenCalledTimes(1);
  expect(jest.mocked(completeLlm).mock.calls[0][0][1].content).toContain('copper lamp');
});
test('AI controls direction without changing choices or dialogue, regardless of result order', async () => {
  jest
    .mocked(completeLlm)
    .mockResolvedValue(
      JSON.stringify({
        shots: example.shots
          .map((s) => ({
            id: s.id,
            seconds: 6,
            movement: '\u53f3\u6447',
            tags: ['\u6697\u573a'],
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
      movement: '\u53f3\u6447',
      tags: ['\u6697\u573a'],
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

test('retries a busy background service and identifies an unreadable cast reference before requesting a background', async () => {
  const original = process.env.PIXELLAB_API_KEY;
  process.env.PIXELLAB_API_KEY = 'test';
  try {
    const png = await (await import('sharp')).default({create:{width:192,height:112,channels:4,background:'blue'}}).png().toBuffer();
    const provider = (outboundFetch as jest.Mock).mockReset()
      .mockResolvedValueOnce(new Response(null, {status:503}))
      .mockResolvedValueOnce(Response.json({image:{base64:png.toString('base64')}}));
    jest.mocked(completeLlm).mockResolvedValue(JSON.stringify({background:'Bus shelter',characters:[]}));
    const response = await run(true, {artworkShotId:'start',board:{...example,characterGuide:'None',castSprites:[]}});
    expect(await response.json()).toMatchObject({visibleCast:[], artwork:expect.stringMatching(/^data:image/)});
    expect(provider).toHaveBeenCalledTimes(2);
    jest.mocked(completeLlm).mockResolvedValue(JSON.stringify({background:'Bus shelter',characters:['Lin']}));
    const invalid = await run(true, {artworkShotId:'start',board:{...example,characterGuide:'Lin — blue coat',
      castSprites:[{name:'Lin',appearance:'Lin — blue coat',image:'data:image/png;base64,iVBORw0KGgo='}]}});
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).error).toContain('Lin');
    expect(provider).toHaveBeenCalledTimes(2);
  } finally {
    if (original===undefined) delete process.env.PIXELLAB_API_KEY;
    else process.env.PIXELLAB_API_KEY=original;
  }
});

test('reuses the branch background for a dialogue beat, while an explicit redraw calls PixelLab', async () => {
  const original = process.env.PIXELLAB_API_KEY;
  process.env.PIXELLAB_API_KEY = 'test';
  try {
    const png = await (await import('sharp')).default({create:{width:192,height:112,channels:4,background:'blue'}}).png().toBuffer();
    const backdrop = 'data:image/png;base64,' + png.toString('base64');
    const board = {...example, characterGuide:'None', castSprites:[], shots:example.shots.map((shot,i) => i ? shot : {...shot, backdrop})};
    const provider = (outboundFetch as jest.Mock).mockReset().mockResolvedValue(Response.json({image:{base64:png.toString('base64')}}));
    jest.mocked(completeLlm).mockResolvedValue(JSON.stringify({background:'Same room',characters:[],reuseBackdrop:true}));
    const reused = await run(true,{artworkShotId:'door',board});
    expect(reused.headers.get('x-backdrop-source')).toBe('previous-shot');
    expect((await reused.json()).backdrop).toBe(backdrop);
    expect(provider).not.toHaveBeenCalled();
    const redraw = await run(true,{artworkShotId:'door',board,redrawBackground:true});
    expect(redraw.headers.get('x-backdrop-source')).toBe('generated');
    expect(provider).toHaveBeenCalledTimes(1);
  } finally {
    if (original===undefined) delete process.env.PIXELLAB_API_KEY;
    else process.env.PIXELLAB_API_KEY=original;
  }
});

test('translates a non-English portrait prompt without rewriting the author profile', async () => {
  const original = process.env.PIXELLAB_API_KEY;
  process.env.PIXELLAB_API_KEY = 'test';
  try {
    const appearance = '\u5c0f\u96e8 - \u9752\u5e74\u5973\u6027，\u9ec4\u8272\u96e8\u8863，\u84dd\u8272\u80cc\u5305。';
    jest.mocked(completeLlm).mockResolvedValue('Young adult woman wearing a yellow raincoat and a blue backpack.');
    const provider = (outboundFetch as jest.Mock).mockReset().mockResolvedValue(Response.json({image:{base64:'iVBORw0KGgoA'}}));
    const res = await run(true, {prepareCast:true, characterName:'\u5c0f\u96e8', board:{...example,characterGuide:appearance}});
    const result = await res.json();
    expect(result.castSprites[0].appearance).toBe(appearance);
    expect(JSON.parse(provider.mock.calls[0][1].body).description).toContain('yellow raincoat');
  } finally {
    if (original === undefined) delete process.env.PIXELLAB_API_KEY;
    else process.env.PIXELLAB_API_KEY = original;
  }
});
