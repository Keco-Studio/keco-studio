import { describe, expect, it, jest } from '@jest/globals';
import {
  generateProfessionalStage,
  type ProfessionalCheckpoint,
  type ProfessionalBlueprint,
} from './professionalStages';
import type { GddGenerationRequestV2 } from './contracts';

const input: GddGenerationRequestV2 = {
  contractVersion: 2,
  mode: 'professional',
  language: 'zh-CN',
  projectId: 'project-1',
  projectName: 'Test Game',
  designSystemId: 'system-1',
  versionId: 'version-1',
  versionNumber: 1,
  systemTitle: 'Test System',
  rules: {
    schemaVersion: 1,
    genres: ['Puzzle'],
    philosophies: ['Readable rules'],
    suitableFor: 'Players',
    rules: [],
    tableGuidance: [],
  },
  designDocument: {
    gameBackground: 'A test world.',
    designIntent: 'Test intent.',
    playerFantasy: 'Test fantasy.',
    coreLoop: 'Observe and act.',
    decisionStructure: 'Choose one action.',
    systemBoundaries: 'Offline only.',
    progressionEconomy: 'Linear.',
    contentModel: 'Levels.',
    difficultyBalance: 'Fair.',
    experiencePresentation: 'Clear.',
  },
  projectSources: [],
};

const blueprint: ProfessionalBlueprint = {
  version: 1,
  title: 'Test Game GDD',
  sections: [
    { id: 'core-loop', title: 'Core Loop', stage: 'core', instructions: ['Define the loop.'] },
    { id: 'systems', title: 'Systems', stage: 'systems', instructions: ['Define numbers.'] },
    { id: 'content', title: 'Content', stage: 'content', instructions: ['Define content.'] },
  ],
  invariants: ['Use the same numbers everywhere.'],
};

function checkpoint(overrides: Partial<ProfessionalCheckpoint> = {}): ProfessionalCheckpoint {
  return {
    blueprint: null,
    section_drafts: [],
    review_report: null,
    repair_round: 0,
    ...overrides,
  };
}

describe('professional GDD stages', () => {
  it('parses a planning blueprint from a JSON-only completion', async () => {
    const complete = jest.fn(async () => JSON.stringify(blueprint));

    const result = await generateProfessionalStage(input, 'planning', checkpoint(), { complete });

    expect(result.blueprint).toEqual(blueprint);
    expect(result.sectionDrafts).toEqual([]);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('normalizes common planning aliases returned by the model', async () => {
    const complete = jest.fn(async () => JSON.stringify({
      version: '1.0',
      title: 'Test Game GDD',
      sections: [
        { id: 'core-loop', title: 'Core Loop', category: 'core_loop', summary: 'Define the loop.' },
        { id: 'systems', title: 'Systems', category: 'systems', summary: 'Define numbers.' },
        { id: 'content', title: 'Content', category: 'content', summary: 'Define content.' },
      ],
      invariants: [],
    }));

    const result = await generateProfessionalStage(input, 'planning', checkpoint(), { complete });

    expect(result.blueprint).toEqual(expect.objectContaining({
      version: 1,
      title: 'Test Game GDD',
      sections: blueprint.sections,
      invariants: [],
    }));
  });

  it('normalizes semantic version aliases and object invariants', async () => {
    const complete = jest.fn(async () => JSON.stringify({
      version: '1.0.0',
      title: 'Test Game GDD',
      sections: [
        { id: 'core-loop', title: 'Core Loop', stage: 'core', instructions: ['Define the loop.'] },
        { id: 'systems', title: 'Systems', stage: 'systems', instructions: ['Define numbers.'] },
        { id: 'content', title: 'Content', stage: 'content', instructions: ['Define content.'] },
      ],
      invariants: [{ statement: 'Use the same numbers everywhere.' }],
    }));

    const result = await generateProfessionalStage(input, 'planning', checkpoint(), { complete });

    expect(result.blueprint).toEqual(expect.objectContaining({
      version: 1,
      invariants: ['Use the same numbers everywhere.'],
    }));
  });

  it('ignores a top-level tables planning hint while preserving the strict blueprint contract', async () => {
    const complete = jest.fn(async () => JSON.stringify({
      version: 1,
      title: 'Test Game GDD',
      sections: blueprint.sections,
      invariants: [],
      tables: ['LevelLayouts', 'NPCScripts'],
    }));

    const result = await generateProfessionalStage(input, 'planning', checkpoint(), { complete });

    expect(result.blueprint).toEqual(expect.objectContaining({
      version: 1,
      title: 'Test Game GDD',
      sections: blueprint.sections,
      invariants: [],
    }));
  });

  it('repairs one malformed planning response before failing the stage', async () => {
    const complete = jest.fn(async (..._args: unknown[]) => JSON.stringify(blueprint))
      .mockResolvedValueOnce('{"version":1,"title":"Test Game GDD","sections":[{"id":"core-loop","title":"Core Loop","stage":"core","instructions":["Define the loop."]}],"invariants":["unterminated')
      .mockResolvedValueOnce(JSON.stringify(blueprint));

    const result = await generateProfessionalStage(input, 'planning', checkpoint(), { complete });

    expect(result.blueprint).toEqual(blueprint);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('passes the requested output language and full table contract to stage prompts', async () => {
    const complete = jest.fn(async () => JSON.stringify(blueprint));
    await generateProfessionalStage({ ...input, language: 'en-US' }, 'planning', checkpoint(), { complete });
    const calls = complete.mock.calls as unknown as Array<unknown[]>;
    const firstMessages = calls[0]?.[0] as Array<{ content?: unknown }> | undefined;
    expect(String(firstMessages?.[0]?.content)).toMatch(/English|en-US|same language/i);

    complete.mockResolvedValueOnce('## Systems\n\nRules and values.');
    await generateProfessionalStage({ ...input, language: 'en-US' }, 'generating_systems', checkpoint({ blueprint }), { complete });
    const secondMessages = calls[1]?.[0] as Array<{ content?: unknown }> | undefined;
    const systemPrompt = String(secondMessages?.[0]?.content);
    expect(systemPrompt).toMatch(/English|en-US|same language/i);
    expect(systemPrompt).toContain('KECO_TABLE_PLAN');
    expect(systemPrompt).toContain('KECO_TABLE_REF');
    expect(systemPrompt).toMatch(/Do not render Markdown tables|Do not use Markdown tables/i);
    expect(systemPrompt).toMatch(/at least 3 .*paragraphs/i);
    expect(systemPrompt).toMatch(/exact heading|exact title|heading.*exact/i);
    expect(systemPrompt).toMatch(/H1|H2|H3|heading hierarchy/i);
    expect(systemPrompt).toMatch(/bullet|numbered list/i);
  });

  it('uses the explicit Chinese game title from the creative brief instead of a model title', async () => {
    const complete = jest.fn(async () => JSON.stringify({
      ...blueprint,
      title: 'Adventure 2 - Game Design Document',
      sections: [
        { id: 'core-loop', title: '\u6838\u5fc3\u5faa\u73af', stage: 'core', instructions: ['\u5b9a\u4e49\u5faa\u73af\u3002'] },
        { id: 'systems', title: '\u7cfb\u7edf\u89c4\u5219', stage: 'systems', instructions: ['\u5b9a\u4e49\u6570\u503c\u3002'] },
        { id: 'content', title: '\u5173\u5361\u5185\u5bb9', stage: 'content', instructions: ['\u5b9a\u4e49\u5185\u5bb9\u3002'] },
      ],
      invariants: ['\u4f7f\u7528\u4e00\u81f4\u6570\u503c\u3002'],
    }));

    const result = await generateProfessionalStage({
      ...input,
      projectName: '\u5192\u9669\u95ef\u51732',
      creativeBrief: '\u9879\u76ee\u540d\u300a\u52c7\u95ef\u4e4b\u8def\u300b\uff0c\u8bf7\u751f\u6210\u4e2d\u6587\u6e38\u620f\u8bbe\u8ba1\u6587\u6863\u3002',
    }, 'planning', checkpoint(), { complete });

    expect(result.blueprint?.title).toBe('\u300a\u52c7\u95ef\u4e4b\u8def\u300b\u6e38\u620f\u8bbe\u8ba1\u6587\u6863');
    const calls = complete.mock.calls as unknown as Array<unknown[]>;
    const messages = calls[0]?.[0] as Array<{ content?: unknown }> | undefined;
    expect(String(messages?.[0]?.content)).toContain('\u300a\u52c7\u95ef\u4e4b\u8def\u300b\u6e38\u620f\u8bbe\u8ba1\u6587\u6863');
    expect(String(messages?.[0]?.content)).toMatch(/Chinese|Simplified/i);
  });

  it('repairs an English-dominant Chinese stage into structured Chinese Markdown', async () => {
    const chineseBlueprint: ProfessionalBlueprint = {
      ...blueprint,
      title: '\u300a\u52c7\u95ef\u4e4b\u8def\u300b\u6e38\u620f\u8bbe\u8ba1\u6587\u6863',
      sections: [
        { id: 'core-loop', title: '\u6838\u5fc3\u5faa\u73af', stage: 'core', instructions: ['\u5b9a\u4e49\u5faa\u73af\u3002'] },
        { id: 'systems', title: '\u7cfb\u7edf\u89c4\u5219', stage: 'systems', instructions: ['\u5b9a\u4e49\u6570\u503c\u3002'] },
        { id: 'content', title: '\u5173\u5361\u5185\u5bb9', stage: 'content', instructions: ['\u5b9a\u4e49\u5185\u5bb9\u3002'] },
      ],
      invariants: ['\u4f7f\u7528\u4e00\u81f4\u6570\u503c\u3002'],
    };
    const english = `## Core Loop\n\n${'The player explores, fights, grows, and advances through the world. '.repeat(30)}`;
    const repaired = [
      '## \u6838\u5fc3\u5faa\u73af',
      '',
      '### \u5faa\u73af\u6b65\u9aa4',
      '',
      '1. \u73a9\u5bb6\u4fa6\u5bdf\u5f53\u524d\u533a\u57df\u3002',
      '2. \u73a9\u5bb6\u9009\u62e9\u884c\u52a8\u5e76\u7ed3\u7b97\u3002',
      '',
      '### \u5b8c\u6210\u6761\u4ef6',
      '',
      '- **\u76ee\u6807\uff1a** \u62b5\u8fbe\u51fa\u53e3\u3002',
      '- **\u53cd\u9988\uff1a** \u663e\u793a\u72b6\u6001\u53d8\u5316\u3002',
    ].join('\n');
    const complete = jest.fn(async () => repaired).mockResolvedValueOnce(english);

    const result = await generateProfessionalStage({ ...input, language: 'zh-CN' }, 'generating_core', checkpoint({
      blueprint: chineseBlueprint,
    }), { complete });

    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.sectionDrafts[0]?.markdown).toBe(repaired);
    const calls = complete.mock.calls as unknown as Array<unknown[]>;
    const repairMessages = calls[1]?.[0] as Array<{ content?: unknown }> | undefined;
    expect(String(repairMessages?.[0]?.content)).toMatch(/Chinese|Simplified/i);
    expect(String(repairMessages?.[0]?.content)).toMatch(/H3|bullet|numbered list/i);
  });

  it('normalizes generated section headings to the blueprint titles', async () => {
    const complete = jest.fn(async () => '## A different heading\n\nThe player observes the board.');
    const result = await generateProfessionalStage(input, 'generating_core', checkpoint({ blueprint }), { complete });

    expect(result.sectionDrafts[0]?.markdown).toMatch(/^## Core Loop\b/);
    expect(result.sectionDrafts[0]?.markdown).not.toMatch(/^## A different heading/m);
  });

  it('keeps subsection headings inside their parent section', async () => {
    const twoCoreSections: ProfessionalBlueprint = {
      ...blueprint,
      sections: [
        { id: 'core-loop', title: 'Core Loop', stage: 'core', instructions: ['Define the loop.'] },
        { id: 'core-actions', title: 'Player Actions', stage: 'core', instructions: ['Define actions.'] },
        ...blueprint.sections.slice(1),
      ],
    };
    const complete = jest.fn(async () => [
      '## Core Loop',
      '',
      'Observe the world.',
      '',
      '### Player Actions',
      '',
      'Choose, move, and commit.',
      '',
      '## Player Actions',
      '',
      'Actions resolve against the current state.',
    ].join('\n'));

    const result = await generateProfessionalStage(input, 'generating_core', checkpoint({ blueprint: twoCoreSections }), { complete });

    expect(result.sectionDrafts).toEqual([
      expect.objectContaining({ sectionId: 'core-loop', markdown: expect.stringContaining('### Player Actions') }),
      expect.objectContaining({ sectionId: 'core-actions', markdown: expect.stringContaining('Actions resolve') }),
    ]);
  });

  it('asks planning to produce a production-sized blueprint', async () => {
    const complete = jest.fn(async () => JSON.stringify(blueprint));
    await generateProfessionalStage(input, 'planning', checkpoint(), { complete });
    const planningCalls = complete.mock.calls as unknown as Array<unknown[]>;
    const messages = planningCalls[0]?.[0] as Array<{ content?: unknown }> | undefined;
    const prompt = String(messages?.[0]?.content);
    expect(prompt).toMatch(/9.?12|at least 9|nine/i);
    expect(prompt).toMatch(/core.*systems.*content/i);
    expect(prompt).toMatch(/concrete|executable/i);
  });

  it('gives planning enough completion budget for the full blueprint', async () => {
    const complete = jest.fn(async () => JSON.stringify(blueprint));
    await generateProfessionalStage(input, 'planning', checkpoint(), { complete });

    const calls = complete.mock.calls as unknown as Array<unknown[]>;
    const options = calls[0]?.[1] as { maxCompletionTokens?: number } | undefined;
    expect(options?.maxCompletionTokens).toBeGreaterThanOrEqual(8_000);
  });

  it('generates core drafts and preserves drafts from earlier stages', async () => {
    const complete = jest.fn(async () => '## Core Loop\n\nThe player observes the board.');
    const previous = [{ sectionId: 'systems', stage: 'systems' as const, markdown: '## Systems\n\nNumbers.' }];

    const result = await generateProfessionalStage(input, 'generating_core', checkpoint({
      blueprint,
      section_drafts: previous,
    }), { complete });

    expect(result.blueprint).toEqual(blueprint);
    expect(result.sectionDrafts).toEqual([
      { sectionId: 'core-loop', stage: 'core', markdown: '## Core Loop\n\nThe player observes the board.' },
      ...previous,
    ]);
  });

  it('replaces drafts for the current stage instead of appending duplicates', async () => {
    const complete = jest.fn(async () => '## Systems\n\nUpdated numbers.');
    const previous = [
      { sectionId: 'core-loop', stage: 'core' as const, markdown: '## Core Loop\n\nCore.' },
      { sectionId: 'systems', stage: 'systems' as const, markdown: 'Old.' },
    ];

    const result = await generateProfessionalStage(input, 'generating_systems', checkpoint({
      blueprint,
      section_drafts: previous,
    }), { complete });

    expect(result.sectionDrafts).toEqual([
      { sectionId: 'core-loop', stage: 'core', markdown: '## Core Loop\n\nCore.' },
      { sectionId: 'systems', stage: 'systems', markdown: '## Systems\n\nUpdated numbers.' },
    ]);
  });

  it('rejects malformed planning JSON and propagates an already-aborted signal', async () => {
    await expect(generateProfessionalStage(input, 'planning', checkpoint(), {
      complete: jest.fn(async () => '{bad json}'),
    })).rejects.toThrow(/blueprint/i);

    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    const complete = jest.fn(async () => JSON.stringify(blueprint));
    await expect(generateProfessionalStage(input, 'planning', checkpoint(), {
      complete,
    }, controller.signal)).rejects.toThrow('cancelled');
    expect(complete).not.toHaveBeenCalled();
  });
});
