import { z } from 'zod';
import { withAuth } from '@/lib/auth/route-auth';
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

export const POST = withAuth(async (request, _ctx, { supabase }) => {
  let input;
  try {
    input = z
      .object({
        projectId: z.string().uuid(),
        libraryId: z.string().uuid(),
        board: z.unknown(),
        brief: z.string().max(1000),
      })
      .strict()
      .parse(await request.json());
  } catch {
    return Response.json({ error: '镜头生成请求格式无效。' }, { status: 400 });
  }
  const { data: library, error } = await supabase
    .from('libraries')
    .select('id')
    .eq('id', input.libraryId)
    .eq('project_id', input.projectId)
    .eq('document_export_type', 'script')
    .maybeSingle();
  if (error || !library)
    return Response.json({ error: '无法访问此 Script。' }, { status: 403 });
  let board;
  try {
    board = checkBoard(input.board);
  } catch {
    return Response.json(
      { error: '请先修正镜头和分支目标。' },
      { status: 400 },
    );
  }
  if (board.shots.length > 60 || JSON.stringify(board).length > 32000)
    return Response.json(
      { error: '每次最多生成 60 个镜头、32000 字符。' },
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
          content: JSON.stringify({ direction: input.brief, board }),
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
        toolName: 'direct_shots',
        maxCompletionTokens: 8000,
        signal: request.signal,
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
  } catch {
    return Response.json(
      {
        error:
          'AI 镜头生成失败，请检查服务端模型配置或稍后重试。当前草稿已保留。',
      },
      { status: 502 },
    );
  }
});
