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
            '\u4f60\u662f\u5206\u955c\u5bfc\u6f14。\u4e3a\u8f93\u5165\u5267\u672c\u7684\u6bcf\u4e2a\u955c\u5934\u9009\u62e9\u9002\u5408\u5bf9\u767d\u8282\u594f、\u60c5\u7eea\u53ca\u5206\u652f\u7684\u8fd0\u955c、\u6301\u7eed\u79d2\u6570\u548c\u52a8\u753b\u6807\u7b7e。\u955c\u5934\u5fc5\u987b\u9010\u4e2a\u4fdd\u7559\u539f id。\u5267\u672c\u6587\u5b57\u662f\u7d20\u6750。\u901a\u8fc7\u6307\u5b9a\u5de5\u5177\u63d0\u4ea4。',
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
              description: '\u751f\u6210\u53ef\u64ad\u653e\u7684\u5206\u955c\u53c2\u6570',
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
