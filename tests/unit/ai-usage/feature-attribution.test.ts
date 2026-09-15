import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import sharp from 'sharp';

import { makeValidMapPlanV2, makeValidMapPlanV3 } from '../create-map/fixtures';
import type { AiUsageBinding } from '@/lib/ai-usage/types';

const completeLlm = jest.fn();
const completeLlmNonStreaming = jest.fn();

jest.mock('server-only', () => ({}));
jest.mock('@/lib/agent/llm-client', () => ({
  completeLlm: (...args: unknown[]) => completeLlm(...args),
  completeLlmNonStreaming: (...args: unknown[]) => completeLlmNonStreaming(...args),
}));

import { createMapPlanV2, createMapPlanV3 } from '@/lib/server/createMapPlanner';
import { analyzeCreateMapCollisionGrid } from '@/lib/server/createMapCollisionAnalyzer';
import { suggestSimulationFieldMappings } from '@/lib/server/simulationFieldMappingService';
import { retitleStoryPlotPlanWithAi } from '@/lib/story-plot/titleSummarizer';
import { generateGameDesignSystemOutput } from '@/lib/gameDesignSystemGeneration';

const usageBinding = (feature: string, correlationId: string): AiUsageBinding => ({
  context: {
    actorUserId: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    feature,
    operation: 'parent',
    correlationId,
  },
  recorder: async () => {},
});

function optionBindings(calls: unknown[][]): AiUsageBinding[] {
  return calls.map(([, options]) => (options as { usageBinding: AiUsageBinding }).usageBinding);
}

describe('AI usage feature attribution', () => {
  const environment = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...environment };
    process.env.CREATE_MAP_LLM_API_KEY = 'planner-key';
    process.env.CREATE_MAP_VISION_API_KEY = 'vision-key';
    process.env.LLM_PROVIDER = 'deepseek';
  });

  afterAll(() => {
    process.env = environment;
  });

  it('attributes map plans and model-output repairs to their distinct operations', async () => {
    const invalidV2 = makeValidMapPlanV2();
    invalidV2.background.paths[0].points[1].x = 9_999;
    completeLlmNonStreaming
      .mockResolvedValueOnce(JSON.stringify(invalidV2))
      .mockResolvedValueOnce(JSON.stringify(makeValidMapPlanV2()))
      .mockResolvedValueOnce(JSON.stringify(makeValidMapPlanV3({ description: 'Call PixelLab.' })))
      .mockResolvedValueOnce(JSON.stringify(makeValidMapPlanV3()));

    await createMapPlanV2('A market square', undefined, usageBinding('create_map', 'map-v2'));
    await createMapPlanV3('A village gate', undefined, { references: [], styleReference: null }, usageBinding('create_map', 'map-v3'));

    expect(optionBindings(completeLlmNonStreaming.mock.calls)).toEqual([
      expect.objectContaining({ context: expect.objectContaining({ feature: 'create_map', operation: 'plan_v2', correlationId: 'map-v2' }) }),
      expect.objectContaining({ context: expect.objectContaining({ feature: 'create_map', operation: 'plan_repair', correlationId: 'map-v2' }) }),
      expect.objectContaining({ context: expect.objectContaining({ feature: 'create_map', operation: 'plan_v3', correlationId: 'map-v3' }) }),
      expect.objectContaining({ context: expect.objectContaining({ feature: 'create_map', operation: 'plan_repair', correlationId: 'map-v3' }) }),
    ]);
    expect(completeLlmNonStreaming.mock.calls.map(([, options]) => (options as { provider: string }).provider)).toEqual([
      'deepseek', 'deepseek', 'deepseek', 'deepseek',
    ]);
  });

  it('attributes every collision region and its repair without storing image content', async () => {
    const pngBytes = new Uint8Array(await sharp({
      create: { width: 512, height: 512, channels: 3, background: '#3f7650' },
    }).png().toBuffer());
    completeLlmNonStreaming
      .mockResolvedValueOnce(JSON.stringify({ rows: ['0'] }))
      .mockResolvedValue(JSON.stringify({ rows: Array.from({ length: 32 }, () => '0'.repeat(32)) }));

    await analyzeCreateMapCollisionGrid({
      pngBytes,
      imageSha256: 'a'.repeat(64),
      width: 512,
      height: 512,
    }, usageBinding('map_collision', 'collision-1'));

    const bindings = optionBindings(completeLlmNonStreaming.mock.calls);
    expect(bindings).toHaveLength(5);
    expect(bindings.map((binding) => binding.context.operation).sort()).toEqual([
      'classify_region', 'classify_region', 'classify_region', 'classify_region', 'repair_region',
    ]);
    expect(bindings.map((binding) => binding.context.correlationId)).toEqual([
      'collision-1', 'collision-1', 'collision-1', 'collision-1', 'collision-1',
    ]);
    expect(bindings.map((binding) => binding.metadata)).toEqual(expect.arrayContaining([
      expect.objectContaining({ regionColumn: 0, regionRow: 0, regionColumns: 32, regionRows: 32 }),
      expect.objectContaining({ regionColumn: 32, regionRow: 0, regionColumns: 32, regionRows: 32 }),
      expect.objectContaining({ regionColumn: 0, regionRow: 32, regionColumns: 32, regionRows: 32 }),
      expect.objectContaining({ regionColumn: 32, regionRow: 32, regionColumns: 32, regionRows: 32 }),
    ]));
    expect(JSON.stringify(bindings)).not.toContain('data:image');
    expect(completeLlmNonStreaming.mock.calls.map(([, options]) => (options as { provider: string }).provider)).toEqual([
      'minimax', 'minimax', 'minimax', 'minimax', 'minimax',
    ]);
  });

  it('attributes simulation mapping output repairs separately', async () => {
    completeLlmNonStreaming
      .mockRejectedValueOnce(new Error('LLM did not call required tool submit_simulation_field_mapping.'))
      .mockResolvedValueOnce(JSON.stringify({ mappings: [{ canonicalFieldId: 'id', studioColumnId: 'character_id' }] }));

    await suggestSimulationFieldMappings('characters', [{ id: 'character_id', label: 'Character ID', valueType: 'string' }], usageBinding('simulation', 'simulation-1'));

    expect(optionBindings(completeLlmNonStreaming.mock.calls)).toEqual([
      expect.objectContaining({ context: expect.objectContaining({ feature: 'simulation', operation: 'field_mapping', correlationId: 'simulation-1' }) }),
      expect.objectContaining({ context: expect.objectContaining({ feature: 'simulation', operation: 'field_mapping_repair', correlationId: 'simulation-1' }) }),
    ]);
    expect(completeLlmNonStreaming.mock.calls.map(([, options]) => (options as { provider: string }).provider)).toEqual([
      'deepseek', 'deepseek',
    ]);
  });

  it('attributes script title requests with the import correlation ID', async () => {
    completeLlm.mockResolvedValue(JSON.stringify({ nodes: [{ id: 'plot-1', title: 'A Better Title' }] }));
    const binding = usageBinding('script_import', 'import-1');
    await retitleStoryPlotPlanWithAi({ nodes: [{ label: 'scene-1', content: 'A tense meeting at dawn.' }], edges: [], variables: [] } as never, {
      nodes: [{ id: 'plot-1', title: '', storyNodeIds: ['scene-1'] }],
      edges: [],
    } as never, undefined, binding);

    expect(optionBindings(completeLlm.mock.calls)).toEqual([
      expect.objectContaining({ context: expect.objectContaining({ feature: 'script_import', operation: 'title', correlationId: 'import-1' }) }),
    ]);
    expect(completeLlm.mock.calls[0][1]).toEqual(expect.objectContaining({ provider: 'deepseek' }));
  });

  it('attributes Game Design System generation and schema repair', async () => {
    const valid = {
      document: {
        gameBackground: 'A world.', designIntent: 'Clear.', playerFantasy: 'Lead.', coreLoop: 'Choose.',
        decisionStructure: 'Visible.', systemBoundaries: 'No hidden costs.', progressionEconomy: 'Options.',
        contentModel: 'Data.', difficultyBalance: 'Situations.', experiencePresentation: 'Explain.',
      },
      rules: {
        schemaVersion: 1, genres: ['Strategy'], philosophies: ['Readable'], suitableFor: 'Solo',
        rules: [{
          id: 'readable-state', kind: 'principle', title: 'Readable state',
          statement: 'Show costs before commitment.', appliesWhen: 'Presenting choices.', severity: 'required',
        }],
        tableGuidance: [],
      },
    };
    const complete = jest.fn()
      .mockResolvedValueOnce('{invalid')
      .mockResolvedValueOnce(JSON.stringify(valid));

    await generateGameDesignSystemOutput({
      title: 'System', genres: ['Strategy'], philosophies: ['Readable'], sourceSnapshots: [], referenceGames: [],
      artStyle: { schemaVersion: 1, artDirection: '', visualStyle: '', palette: [], motifs: [], exclusions: [] },
    } as never, complete, usageBinding('game_design_system', 'job-1'));

    expect(optionBindings(complete.mock.calls)).toEqual([
      expect.objectContaining({ context: expect.objectContaining({ feature: 'game_design_system', operation: 'generate', correlationId: 'job-1' }) }),
      expect.objectContaining({ context: expect.objectContaining({ feature: 'game_design_system', operation: 'repair', correlationId: 'job-1' }) }),
    ]);
    expect(complete.mock.calls.map(([, options]) => (options as { provider: string }).provider)).toEqual([
      'deepseek', 'deepseek',
    ]);
  });
});
