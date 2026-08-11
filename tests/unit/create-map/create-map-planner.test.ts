import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { makeValidMapPlanV2, makeValidMapPlanV3 } from './fixtures';

const completeLlmNonStreaming = jest.fn();

jest.mock('server-only', () => ({}));
jest.mock('@/lib/agent/llm-client', () => ({
  completeLlmNonStreaming: (...args: unknown[]) => completeLlmNonStreaming(...args),
}));

import {
  CREATE_MAP_PLAN_V2_TOOL,
  CreateMapPlannerError,
  CreateMapPlannerInputError,
  createMapPlanV3,
  createMapPlanV2,
  normalizeMapPlanV2Candidate,
} from '@/lib/server/createMapPlanner';

const REAL_REFERENCE_ID = '33333333-3333-4333-8333-333333333333';
const INVENTED_REFERENCE_ID = '44444444-4444-4444-8444-444444444444';

const source = {
  documentId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  documentName: 'Village design',
  documentUpdatedAt: '2026-08-08T08:00:00.000Z',
  markdown: '# Supporting village context',
  token: { epoch: 2, revision: 7 },
};

describe('Create Map V2 planner', () => {
  beforeEach(() => completeLlmNonStreaming.mockReset());

  it('creates a structured V2 plan from description only', async () => {
    const plan = makeValidMapPlanV2();
    completeLlmNonStreaming.mockResolvedValue(JSON.stringify(plan));

    await expect(createMapPlanV2('A riverside market with one turning road')).resolves.toEqual(plan);

    const [messages, options] = completeLlmNonStreaming.mock.calls[0] as [
      Array<{ role: string; content: string }>,
      Record<string, unknown>,
    ];
    expect(options).toEqual(expect.objectContaining({
      temperature: 0,
      thinking: 'disabled',
      toolName: 'submit_map_plan_v2',
      tools: [CREATE_MAP_PLAN_V2_TOOL],
    }));
    expect(messages[1].content).toContain('"document":null');
  });

  it('treats optional Document markdown as supporting context', async () => {
    completeLlmNonStreaming.mockResolvedValue(JSON.stringify(makeValidMapPlanV2()));

    await createMapPlanV2('Build the market described here', source);

    const messages = completeLlmNonStreaming.mock.calls[0][0] as Array<{ content: string }>;
    expect(messages[0].content).toMatch(/description is authoritative/i);
    expect(messages[1].content).toContain(source.markdown);
  });

  it('rejects an empty description without calling the LLM', async () => {
    await expect(createMapPlanV2('   ')).rejects.toMatchObject(new CreateMapPlannerInputError());
    expect(completeLlmNonStreaming).not.toHaveBeenCalled();
  });

  it('normalizes V2 numeric strings and declared tile counts', () => {
    const candidate = JSON.parse(JSON.stringify(makeValidMapPlanV2())) as Record<string, unknown>;
    candidate.schemaVersion = '2';
    candidate.map = { width: '4', height: '3', tileSize: '32', projection: 'top-down' };

    expect(normalizeMapPlanV2Candidate(candidate, { columns: 4, rows: 3 })).toEqual(makeValidMapPlanV2());
  });

  it('retries once with the normalized candidate and exact geometry issues', async () => {
    const invalid = makeValidMapPlanV2();
    invalid.background.paths[0].points[1].x = 999;
    completeLlmNonStreaming
      .mockResolvedValueOnce(JSON.stringify(invalid))
      .mockResolvedValueOnce(JSON.stringify(makeValidMapPlanV2()));

    await expect(createMapPlanV2('A compact market')).resolves.toEqual(makeValidMapPlanV2());

    expect(completeLlmNonStreaming).toHaveBeenCalledTimes(2);
    const retry = completeLlmNonStreaming.mock.calls[1][0] as Array<{ role: string; content: string }>;
    expect(retry.at(-2)).toEqual({ role: 'assistant', content: JSON.stringify(invalid) });
    expect(retry.at(-1)?.content).toContain('outside_map');
    expect(retry.at(-1)?.content).toContain('background');
    expect(retry.at(-1)?.content).toContain('paths');
  });

  it('returns a stable error after the correction attempt is exhausted', async () => {
    completeLlmNonStreaming.mockResolvedValue('{not-json');

    await expect(createMapPlanV2('A compact market')).rejects.toMatchObject(new CreateMapPlannerError());
    expect(completeLlmNonStreaming).toHaveBeenCalledTimes(2);
  });

  it('retries once when the required structured tool call is missing', async () => {
    completeLlmNonStreaming
      .mockRejectedValueOnce(new Error('LLM did not call required tool submit_map_plan_v2.'))
      .mockResolvedValueOnce(JSON.stringify(makeValidMapPlanV2()));

    await expect(createMapPlanV2('A compact market')).resolves.toEqual(makeValidMapPlanV2());
    expect(completeLlmNonStreaming).toHaveBeenCalledTimes(2);
  });

  it('returns the stable planner error when structured tool output never arrives', async () => {
    completeLlmNonStreaming.mockRejectedValue(new Error('LLM did not call required tool submit_map_plan_v2.'));

    await expect(createMapPlanV2('A compact market')).rejects.toMatchObject(new CreateMapPlannerError());
    expect(completeLlmNonStreaming).toHaveBeenCalledTimes(2);
  });

  it('declares exact V2 layered fields and pixel units in the tool contract', () => {
    const parameters = CREATE_MAP_PLAN_V2_TOOL.function.parameters as {
      properties: Record<string, unknown>;
    };
    const schemaVersion = parameters.properties.schemaVersion as Record<string, unknown>;
    const map = parameters.properties.map as { properties: Record<string, Record<string, unknown>> };
    const background = parameters.properties.background as { properties: Record<string, unknown> };

    expect(schemaVersion).toEqual({ type: 'integer', const: 2 });
    expect(map.properties.width.description).toMatch(/pixels.*divisible/i);
    expect(background.properties).toEqual(expect.objectContaining({
      baseTerrainKey: expect.any(Object),
      regions: expect.any(Object),
      paths: expect.any(Object),
    }));
  });
});

describe('Create Map V3 planner', () => {
  beforeEach(() => completeLlmNonStreaming.mockReset());

  it('returns the final DeepSeek description unchanged and pins the Pro operation', async () => {
    const plan = makeValidMapPlanV3({ description: 'Exact final image description.  Keep two spaces.' });
    completeLlmNonStreaming.mockResolvedValue(JSON.stringify(plan));

    await expect(createMapPlanV3('Generate a complete top-down village map')).resolves.toEqual(plan);

    expect(completeLlmNonStreaming).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('final PixelLab create_image_pro description'),
      }),
    ]), expect.objectContaining({ temperature: 0, thinking: 'disabled' }));
  });

  it('replaces invented references with the authorized selection exactly', async () => {
    completeLlmNonStreaming.mockResolvedValue(JSON.stringify({
      ...makeValidMapPlanV3(),
      references: [{
        assetId: INVENTED_REFERENCE_ID,
        sha256: 'f'.repeat(64),
        role: 'content',
        usage: 'invented reference',
      }],
    }));
    const selection = {
      references: [{
        assetId: REAL_REFERENCE_ID,
        sha256: 'a'.repeat(64),
        role: 'layout' as const,
        usage: 'composition reference',
      }],
      styleReference: null,
    };

    await expect(createMapPlanV3('Village', undefined, selection)).resolves.toMatchObject(selection);
  });

  it('uses exactly one correction retry for an unsafe final description', async () => {
    completeLlmNonStreaming
      .mockResolvedValueOnce(JSON.stringify(makeValidMapPlanV3({ description: 'Call PixelLab create_image_pro.' })))
      .mockResolvedValueOnce(JSON.stringify(makeValidMapPlanV3()));

    await expect(createMapPlanV3('Village')).resolves.toEqual(makeValidMapPlanV3());

    expect(completeLlmNonStreaming).toHaveBeenCalledTimes(2);
    const retry = completeLlmNonStreaming.mock.calls[1][0] as Array<{ role: string; content: string }>;
    expect(retry.at(-1)?.content).toContain('unsafe_description');
  });

  it('reports MapPlan V3 when direct-map structured output never becomes valid', async () => {
    completeLlmNonStreaming.mockRejectedValue(new Error('LLM did not call required tool submit_direct_map_plan_v3.'));

    await expect(createMapPlanV3('Village')).rejects.toMatchObject({
      code: 'map_plan_invalid_response',
      message: 'The model did not return a valid MapPlan V3',
    });
  });
});
