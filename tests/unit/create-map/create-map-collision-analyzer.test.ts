import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import sharp from 'sharp';

const completeLlmNonStreaming = jest.fn();
jest.mock('server-only', () => ({}));
jest.mock('@/lib/agent/llm-client', () => ({ completeLlmNonStreaming }));

import {
  CreateMapCollisionAnalyzerError,
  analyzeCreateMapCollisionGrid,
} from '@/lib/server/createMapCollisionAnalyzer';

const input: {
  pngBytes: Uint8Array;
  imageSha256: string;
  width: number;
  height: number;
} = {
  pngBytes: new Uint8Array([137, 80, 78, 71]),
  imageSha256: 'a'.repeat(64),
  width: 512,
  height: 512,
};

describe('Create Map collision analyzer', () => {
  beforeEach(async () => {
    completeLlmNonStreaming.mockReset();
    process.env.CREATE_MAP_VISION_API_URL = 'https://vision.example.test';
    process.env.CREATE_MAP_VISION_API_KEY = 'test-key';
    process.env.CREATE_MAP_VISION_MODEL = 'vision-model';
    process.env.LLM_API_URL = 'https://agent.example.test';
    process.env.LLM_API_KEY = 'agent-key';
    process.env.LLM_MODEL = 'agent-multimodal-model';
    process.env.EMBEDDING_API_URL = 'https://api.minimax.io';
    process.env.EMBEDDING_API_KEY = 'minimax-key';
    input.pngBytes = new Uint8Array(await sharp({
      create: { width: 512, height: 512, channels: 3, background: '#3f7650' },
    }).png().toBuffer());
  });

  it('analyzes a 64x64 grid as four 32x32 MiniMax regions and stitches them', async () => {
    completeLlmNonStreaming.mockResolvedValue(JSON.stringify({
      rows: Array.from({ length: 32 }, (_, row) => row === 2 ? `${'0'.repeat(3)}1${'0'.repeat(28)}` : '0'.repeat(32)),
    }));
    const grid = await analyzeCreateMapCollisionGrid(input);
    expect(grid.cells[2 * 64 + 3]).toBe(1);
    expect(grid.cells).toHaveLength(4096);
    expect(completeLlmNonStreaming).toHaveBeenCalledTimes(4);
    expect(completeLlmNonStreaming).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: expect.arrayContaining([expect.objectContaining({
          type: 'image_url',
          image_url: expect.objectContaining({ url: expect.stringMatching(/^data:image\/png;base64,/) }),
        })]),
      }),
    ]), expect.objectContaining({
      baseUrl: 'https://vision.example.test',
      apiKey: 'test-key',
      model: 'vision-model',
      thinking: 'disabled',
      toolName: 'submit_collision_grid_v1',
      tools: [expect.objectContaining({
        function: expect.objectContaining({
          parameters: expect.objectContaining({
            properties: expect.objectContaining({
              rows: expect.objectContaining({
                minItems: 32,
                maxItems: 32,
                items: expect.objectContaining({ minLength: 32, maxLength: 32 }),
              }),
            }),
          }),
        }),
      })],
    }));
  });

  it('corrects one invalid row response then accepts the replacement', async () => {
    const valid = JSON.stringify({ rows: Array.from({ length: 32 }, () => '0'.repeat(32)) });
    completeLlmNonStreaming
      .mockResolvedValueOnce(JSON.stringify({ rows: ['0'] }))
      .mockResolvedValueOnce(valid)
      .mockResolvedValueOnce(valid)
      .mockResolvedValueOnce(valid)
      .mockResolvedValueOnce(valid);
    await expect(analyzeCreateMapCollisionGrid(input)).resolves.toMatchObject({ columns: 64, rows: 64 });
    expect(completeLlmNonStreaming).toHaveBeenCalledTimes(5);
    const correction = completeLlmNonStreaming.mock.calls
      .map((call) => call[0] as Array<{ content: unknown }>)
      .find((messages) => typeof messages.at(-1)?.content === 'string'
        && messages.at(-1)?.content.includes('Expected exactly 32 rows'));
    expect(correction).toBeDefined();
  });

  it('returns stable invalid-output and configuration errors', async () => {
    completeLlmNonStreaming.mockResolvedValue(JSON.stringify({ rows: ['x'] }));
    await expect(analyzeCreateMapCollisionGrid(input)).rejects.toMatchObject(
      new CreateMapCollisionAnalyzerError('collision_grid_invalid_response'),
    );
    delete process.env.CREATE_MAP_VISION_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.EMBEDDING_API_KEY;
    await expect(analyzeCreateMapCollisionGrid(input)).rejects.toMatchObject(
      new CreateMapCollisionAnalyzerError('vision_not_configured'),
    );
  });

  it('uses MiniMax M3 instead of the Agent model when vision overrides are absent', async () => {
    delete process.env.CREATE_MAP_VISION_API_URL;
    delete process.env.CREATE_MAP_VISION_API_KEY;
    delete process.env.CREATE_MAP_VISION_MODEL;
    completeLlmNonStreaming.mockResolvedValue(JSON.stringify({
      rows: Array.from({ length: 32 }, () => '0'.repeat(32)),
    }));

    await analyzeCreateMapCollisionGrid(input);

    expect(completeLlmNonStreaming).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      baseUrl: 'https://api.minimax.io',
      apiKey: 'minimax-key',
      model: 'MiniMax-M3',
    }));
  });

  it('sanitizes upstream model failures', async () => {
    completeLlmNonStreaming.mockRejectedValue(new Error('provider leaked secret'));
    await expect(analyzeCreateMapCollisionGrid(input)).rejects.toMatchObject(
      new CreateMapCollisionAnalyzerError('vision_upstream_error'),
    );
  });
});
