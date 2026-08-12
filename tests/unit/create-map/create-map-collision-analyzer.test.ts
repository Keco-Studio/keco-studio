import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const completeLlmNonStreaming = jest.fn();
jest.mock('server-only', () => ({}));
jest.mock('@/lib/agent/llm-client', () => ({ completeLlmNonStreaming }));

import {
  CreateMapCollisionAnalyzerError,
  analyzeCreateMapCollisionGrid,
} from '@/lib/server/createMapCollisionAnalyzer';

const input = {
  pngBytes: new Uint8Array([137, 80, 78, 71]),
  imageSha256: 'a'.repeat(64),
  width: 512,
  height: 512,
};

describe('Create Map collision analyzer', () => {
  beforeEach(() => {
    completeLlmNonStreaming.mockReset();
    process.env.CREATE_MAP_VISION_API_URL = 'https://vision.example.test';
    process.env.CREATE_MAP_VISION_API_KEY = 'test-key';
    process.env.CREATE_MAP_VISION_MODEL = 'vision-model';
    process.env.LLM_API_URL = 'https://agent.example.test';
    process.env.LLM_API_KEY = 'agent-key';
    process.env.LLM_MODEL = 'agent-multimodal-model';
  });

  it('sends the image data URL and expands exact tool rows', async () => {
    completeLlmNonStreaming.mockResolvedValue(JSON.stringify({
      rows: Array.from({ length: 64 }, (_, row) => row === 2 ? `${'0'.repeat(3)}1${'0'.repeat(60)}` : '0'.repeat(64)),
    }));
    const grid = await analyzeCreateMapCollisionGrid(input);
    expect(grid.cells[2 * 64 + 3]).toBe(1);
    expect(grid.cells).toHaveLength(4096);
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
      toolName: 'submit_collision_grid_v1',
    }));
  });

  it('corrects one invalid row response then accepts the replacement', async () => {
    completeLlmNonStreaming
      .mockResolvedValueOnce(JSON.stringify({ rows: ['0'] }))
      .mockResolvedValueOnce(JSON.stringify({ rows: Array.from({ length: 64 }, () => '0'.repeat(64)) }));
    await expect(analyzeCreateMapCollisionGrid(input)).resolves.toMatchObject({ columns: 64, rows: 64 });
    expect(completeLlmNonStreaming).toHaveBeenCalledTimes(2);
    const retryMessages = completeLlmNonStreaming.mock.calls[1][0] as Array<{ content: unknown }>;
    expect(retryMessages.at(-1)?.content).toContain('Expected exactly 64 rows');
  });

  it('returns stable invalid-output and configuration errors', async () => {
    completeLlmNonStreaming.mockResolvedValue(JSON.stringify({ rows: ['x'] }));
    await expect(analyzeCreateMapCollisionGrid(input)).rejects.toMatchObject(
      new CreateMapCollisionAnalyzerError('collision_grid_invalid_response'),
    );
    delete process.env.CREATE_MAP_VISION_API_KEY;
    delete process.env.LLM_API_KEY;
    await expect(analyzeCreateMapCollisionGrid(input)).rejects.toMatchObject(
      new CreateMapCollisionAnalyzerError('vision_not_configured'),
    );
  });

  it('reuses the Agent provider and model when vision overrides are absent', async () => {
    delete process.env.CREATE_MAP_VISION_API_URL;
    delete process.env.CREATE_MAP_VISION_API_KEY;
    delete process.env.CREATE_MAP_VISION_MODEL;
    completeLlmNonStreaming.mockResolvedValue(JSON.stringify({
      rows: Array.from({ length: 64 }, () => '0'.repeat(64)),
    }));

    await analyzeCreateMapCollisionGrid(input);

    expect(completeLlmNonStreaming).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      baseUrl: 'https://agent.example.test',
      apiKey: 'agent-key',
      model: 'agent-multimodal-model',
    }));
  });

  it('sanitizes upstream model failures', async () => {
    completeLlmNonStreaming.mockRejectedValue(new Error('provider leaked secret'));
    await expect(analyzeCreateMapCollisionGrid(input)).rejects.toMatchObject(
      new CreateMapCollisionAnalyzerError('vision_upstream_error'),
    );
  });
});
