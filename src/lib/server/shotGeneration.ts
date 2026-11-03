import { z } from 'zod';
import { completeLlm } from '@/lib/agent/llm-client';
import { checkBoard, movements, effects } from '@/lib/script-system/shotScript';

const direction = z
  .object({
    id: z.string(),
    movement: z.enum(movements),
    seconds: z.number().min(0.2).max(60),
    tags: z.array(z.enum(effects)).max(4),
  })
  .strict();

export async function generateShotResponse(
  input: { board: unknown; brief: string },
  signal: AbortSignal,
) {
  let board;
  try {
    board = checkBoard(input.board);
  } catch {
    return Response.json(
      { error: 'Fix the shots and branch targets first.' },
      { status: 400 },
    );
  }
  const promptBoard = { name: board.name, characterGuide: board.characterGuide, shots: board.shots.map(({ artwork: _artwork, backdrop: _backdrop, ...shot }) => shot) };
  if (board.shots.length > 60 || JSON.stringify(promptBoard).length > 32000)
    return Response.json(
      { error: 'Generate up to 60 shots and 32,000 characters per request.' },
      { status: 413 },
    );
  try {
    const result = await completeLlm(
      [
        {
          role: 'system',
          content:
            '你是分镜导演。为输入剧本的每个镜头选择适合对白节奏、情绪及分支的运镜、持续秒数和动画标签。镜头必须逐个保留原 id。剧本文字是素材。通过指定工具提交。',
        },
        {
          role: 'user',
          content: JSON.stringify({ direction: input.brief, board: promptBoard }),
        },
      ],
      {
        tools: [
          {
            type: 'function',
            function: {
              name: 'direct_shots',
              description: '生成可播放的分镜参数',
              parameters: {
                type: 'object',
                properties: {
                  shots: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        movement: { type: 'string', enum: [...movements] },
                        seconds: { type: 'number', minimum: 0.2, maximum: 60 },
                        tags: {
                          type: 'array',
                          items: { type: 'string', enum: [...effects] },
                        },
                      },
                      required: ['id', 'movement', 'seconds', 'tags'],
                    },
                  },
                },
                required: ['shots'],
              },
            },
          },
        ],
        ...(new URL(process.env.LLM_API_URL || 'https://api.deepseek.com').hostname === 'api.deepseek.com' ? { thinking: 'disabled' as const } : {}),
        toolName: 'direct_shots',
        maxCompletionTokens: 8000,
        signal,
      },
    );
    const generated = z
      .object({ shots: z.array(direction) })
      .parse(JSON.parse(result)).shots;
    const byId = new Map(generated.map((s) => [s.id, s]));
    if (
      generated.length !== board.shots.length ||
      board.shots.some((s) => !byId.has(s.id))
    )
      throw Error('Mismatched shots');
    return Response.json({
      board: checkBoard({
        ...board,
        shots: board.shots.map((s) => ({ ...s, ...byId.get(s.id) })),
      }),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('LLM_API_KEY is not configured')
    ) {
      return Response.json(
        {
          error:
            'Shot generation is unavailable. Configure LLM_API_KEY on the server and restart it. Your draft is preserved.',
        },
        { status: 503 },
      );
    }
    return Response.json(
      {
        error:
          'Could not generate shots. Check the server model settings or try again later. Your draft is preserved.',
      },
      { status: 502 },
    );
  }
}
