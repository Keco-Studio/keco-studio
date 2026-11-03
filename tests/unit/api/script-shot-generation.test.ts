import { example } from '@/lib/script-system/shotScript';
import { completeLlm } from '@/lib/agent/llm-client';
import { POST } from '@/app/api/script-shot-generation/route';
jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: unknown) => handler,
}));
jest.mock('@/lib/agent/llm-client', () => ({ completeLlm: jest.fn() }));
const id = '11111111-1111-4111-8111-111111111111';
async function run(allowed = true) {
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
