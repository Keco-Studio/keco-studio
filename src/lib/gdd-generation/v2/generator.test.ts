import { describe, expect, it, jest } from '@jest/globals';
jest.mock('server-only', () => ({}));
import {
  buildBlueprintMessages,
  generateGddBlueprint,
  generateSectionBatch,
  GddV2GenerationValidationError,
} from './generator';
import type { GddGenerationRequestV2 } from './contracts';

const input: GddGenerationRequestV2 = {
  contractVersion: 2,
  mode: 'professional',
  creativeBrief: '一款关于逐渐获得三只流浪猫信任的治愈游戏。',
  language: 'zh-CN',
  projectId: '11111111-1111-4111-8111-111111111111',
  projectName: '街角暖光',
  designSystemId: '22222222-2222-4222-8222-222222222222',
  versionId: '33333333-3333-4333-8333-333333333333',
  versionNumber: 1,
  systemTitle: '治愈陪伴系统',
  rules: {
    schemaVersion: 1,
    genres: ['Simulation'],
    philosophies: ['Behavior-led trust'],
    suitableFor: 'Companion games',
    rules: [{ id: 'behavior-first', kind: 'principle', title: 'Behavior first', statement: 'Show trust through behavior.', appliesWhen: 'Designing reactions.', severity: 'required' }],
    tableGuidance: [],
  },
  designDocument: {
    designIntent: 'Use patient care to create emotional weight.', playerFantasy: 'Be chosen by a wary animal.',
    coreLoop: 'Explore, observe, interact, and return.', decisionStructure: 'Spend limited daily actions.',
    systemBoundaries: 'No forced purchases.', progressionEconomy: 'Trust unlocks behavior.',
    contentModel: 'Cats, places, weather, interactions.', difficultyBalance: 'Weather adds pressure.',
    experiencePresentation: 'Warm watercolor scenes.',
  },
  projectSources: [],
};

const blueprint = {
  version: 2 as const,
  nodes: [
    { id: 'overview', label: '游戏概述', depth: 0, group: 'core' },
    { id: 'systems', label: '系统', depth: 0, group: 'systems' },
    { id: 'presentation', label: '表现', depth: 0, group: 'content' },
  ],
};

describe('GDD v2 staged generator', () => {
  it('builds a professional adaptive blueprint prompt with the creative brief', () => {
    const messages = buildBlueprintMessages(input);
    expect(messages[0].content).toContain('9 to 13 first-level sections');
    expect(messages[0].content).toContain('Do not add a production milestone section');
    expect(messages[1].content).toContain(input.creativeBrief);
    expect(messages[1].content).toContain('BEGIN_UNTRUSTED_GAME_DESIGN_DOCUMENT_DATA');
  });

  it('repairs one malformed blueprint response', async () => {
    const complete = jest.fn(async () => complete.mock.calls.length === 1 ? 'not-json' : JSON.stringify(blueprint));
    await expect(generateGddBlueprint(input, complete)).resolves.toEqual(blueprint);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('generates only the requested section group', async () => {
    const sections = [{ id: 'systems', title: '系统', depth: 0, group: 'systems', blocks: [{ kind: 'paragraph', id: 'systems-p', text: '系统正文。' }], numericRefs: [] }];
    const complete = jest.fn(async () => JSON.stringify(sections));
    await expect(generateSectionBatch(input, blueprint, 'systems', complete)).resolves.toEqual(sections);
    const prompt = (complete.mock.calls[0][0] as Array<{ content: string }>)[1].content;
    expect(prompt).toContain('"id":"systems"');
    expect(prompt).not.toContain('Write only these nodes:\n[{"id":"overview"');
  });

  it('keeps transport errors retryable and fails after two invalid schema responses', async () => {
    const transport = new Error('network');
    await expect(generateGddBlueprint(input, jest.fn(async () => { throw transport; }))).rejects.toBe(transport);
    await expect(generateGddBlueprint(input, jest.fn(async () => '{}'))).rejects.toBeInstanceOf(GddV2GenerationValidationError);
  });
});
