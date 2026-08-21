import { describe, expect, it, jest } from '@jest/globals';
jest.mock('server-only', () => ({}));
import { generateGddMarkdownV2, GddV2GenerationValidationError } from './generator';
import type { ChatMessage } from '@/lib/agent/types';
import type { StreamLlmOptions } from '@/lib/agent/llm-client';
import type { GddGenerationRequestV2 } from './contracts';
import type { DialogueSceneEvent } from './dialogueSceneStream';

const input: GddGenerationRequestV2 = {
  contractVersion: 2,
  mode: 'professional',
  creativeBrief: 'A healing game about gradually earning the trust of three stray cats.',
  language: 'zh-CN',
  projectId: '11111111-1111-4111-8111-111111111111',
  projectName: 'Street-Corner Warmth',
  designSystemId: '22222222-2222-4222-8222-222222222222',
  versionId: '33333333-3333-4333-8333-333333333333',
  versionNumber: 1,
  systemTitle: 'Healing Companion System',
  rules: {
    schemaVersion: 1,
    genres: ['Simulation'],
    philosophies: ['Behavior-led trust'],
    suitableFor: 'Companion games',
    rules: [{ id: 'behavior-first', kind: 'principle', title: 'Behavior first', statement: 'Show trust through behavior.', appliesWhen: 'Designing reactions.', severity: 'required' }],
    tableGuidance: [],
  },
  designDocument: {
    gameBackground: 'A rainy city corner.',
    designIntent: 'Use patient care to create emotional weight.',
    playerFantasy: 'Be chosen by a wary animal.',
    coreLoop: 'Explore, observe, interact, and return.',
    decisionStructure: 'Spend limited daily actions.',
    systemBoundaries: 'No forced purchases.',
    progressionEconomy: 'Trust unlocks behavior.',
    contentModel: 'Cats, places, weather, interactions.',
    difficultyBalance: 'Weather adds pressure.',
    experiencePresentation: 'Warm watercolor scenes.',
  },
  artStyle: null,
  projectSources: [],
};

const sceneEvent: DialogueSceneEvent = {
  chapterKey: 'arrival',
  title: 'Arrival',
  scene: 'The guide blocks the gate and asks the hero for proof.',
  participants: ['Guide', 'Hero'],
  choices: ['Show the letter', 'Leave'],
  consequences: 'Showing the letter opens the gate; leaving postpones entry.',
};

const sceneMarker = (event: DialogueSceneEvent) => `<!-- KECO_DIALOGUE_SCENE ${JSON.stringify(event)} -->`;
const scenePlan = (event: DialogueSceneEvent) => ({
  chapterKey: event.chapterKey,
  title: event.title,
  content: `${event.participants[0] ?? 'Guide'}: Stop.`,
  hasChoices: event.choices.length > 0,
  branchSummary: event.choices,
});

describe('GDD v2 direct Markdown generator', () => {
  it('generates production Markdown in one completion and removes provenance', async () => {
    const complete = jest.fn(async () => [
      '```markdown',
      '# Street-Corner Warmth: Stray Bonds',
      '',
      '## Game Overview',
      'This is the complete overview.',
      '',
      '## Provenance',
      'AI generated from project sources.',
      '',
      '## Core Loop',
      'Enter the map -> Choose a location -> Meet a cat -> Interact.',
      '```',
    ].join('\n'));

    const result = await generateGddMarkdownV2({ ...input, mode: 'quick' }, complete);

    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.markdown).toContain('# Street-Corner Warmth: Stray Bonds');
    expect(result.markdown).toContain('## Core Loop');
    expect(result.markdown).not.toContain('```');
    expect(result.markdown).not.toMatch(/provenance/i);
    expect(result.review).toMatchObject({ status: 'pass', issues: [] });
  });

  it('sends the pinned design document, policy, creative brief, and project source context', async () => {
    const complete = jest.fn(async () => '# GDD\n\n## Game Overview\nBody text.');
    const withSource = {
      ...input,
      rules: { ...input.rules, tableGuidance: [{ table: 'Skills', purpose: 'Actions.', fields: ['Private Field'] }] },
      projectSources: [{
        kind: 'document' as const,
        projectId: input.projectId,
        resourceId: 'source-1',
        label: 'Project Notes',
        contentHash: 'hash-1',
        excerpt: 'Canonical project fact.',
        byteCount: 24,
        truncated: false,
        updatedAt: '2026-08-19T00:00:00Z',
      }],
    };

    await generateGddMarkdownV2(withSource, complete);

    const messages = (complete.mock.calls[0] as unknown as [ChatMessage[]])[0];
    expect(messages[0].content).toContain('Return the finished GDD as Markdown directly');
    expect(messages[0].content).toContain('6,000-9,000 readable Chinese characters');
    expect(messages[0].content).toContain('Do not return JSON');
    expect(messages[0].content).toContain('Do not render Markdown tables in the GDD body');
    expect(messages[0].content).toContain('KECO_TABLE_REF');
    expect(messages[0].content).toContain('follow it exactly');
    expect(messages[0].content).toContain('every concrete entity');
    expect(messages[1].content).toContain('"fields":["Private Field"]');
    expect(messages[1].content).toContain(withSource.creativeBrief!);
    expect(messages[1].content).toContain('"gameBackground":"A rainy city corner."');
    expect(messages[1].content).toContain('behavior-first');
    expect(messages[1].content).toContain('SOURCE DOCUMENT: Project Notes');
    expect(messages[1].content).toContain('Canonical project fact.');
  });

  it('uses the quick mode token budget and prompt constraints', async () => {
    const complete = jest.fn(async () => '# GDD\n\n## Overview\nBody.');

    await generateGddMarkdownV2({ ...input, mode: 'quick' }, complete);

    const messages = (complete.mock.calls[0] as unknown as [ChatMessage[], { maxCompletionTokens: number }])[0];
    expect(messages[0].content).toContain('2,500-3,800 readable Chinese characters');
    expect(messages[0].content).toContain('Use 6-8 major sections');
  });

  it('rejects an empty model response', async () => {
    await expect(generateGddMarkdownV2(input, jest.fn(async () => '   ')))
      .rejects.toBeInstanceOf(GddV2GenerationValidationError);
  });

  it('rejects a response stopped by the provider output limit', async () => {
    const complete = jest.fn(async (_messages: ChatMessage[], options?: StreamLlmOptions) => {
      options?.onFinish?.('length');
      return '# GDD\n\n## Incomplete';
    });

    await expect(generateGddMarkdownV2(input, complete)).rejects.toThrow('output limit');
  });

  it('retries a professional response with compact constraints after an output limit', async () => {
    const complete = jest.fn(async (messages: ChatMessage[], options?: StreamLlmOptions) => {
      if (complete.mock.calls.length === 1) {
        options?.onFinish?.('length');
        return '# GDD\n\n## Truncated';
      }
      expect(messages[0]?.content).toContain('compact recovery pass');
      expect(messages[0]?.content).toContain('KECO_DIALOGUE_SCENE');
      expect(messages[0]?.content).not.toContain('KECO_DIALOGUE_PLAN');
      expect(options?.maxCompletionTokens).toBeGreaterThan(18_000);
      options?.onFinish?.('stop');
      return '# GDD\n\n## Complete\nRecovered content.';
    });

    const result = await generateGddMarkdownV2(input, complete);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.markdown).toContain('Recovered content.');
  });

  it('rejects a document that ends with an empty heading', async () => {
    await expect(generateGddMarkdownV2(input, jest.fn(async () => '# GDD\n\n## Complete\nBody.\n\n## Incomplete')))
      .rejects.toThrow('incomplete heading');
  });

  it('returns a bounded table-plan warning instead of failing the whole GDD', async () => {
    const result = await generateGddMarkdownV2(input, jest.fn(async () => [
      '# GDD',
      '## Core Loop',
      'Body.',
      '<!-- KECO_TABLE_PLAN [{bad json] -->',
    ].join('\n')));
    expect(result.tablePlans).toEqual([]);
    expect(result.tablePlanWarning).toMatch(/not valid JSON/i);
    expect(result.markdown).not.toContain('KECO_TABLE_PLAN');
  });

  it('extracts a strict independent table plan marker from Markdown', async () => {
    const result = await generateGddMarkdownV2(input, jest.fn(async () => [
      '# GDD',
      '<!-- KECO_TABLE_PLAN [{"table":"Skills","purpose":"Actions.","fields":["name"],"rows":[{"name":"Basic","values":{"name":"Basic"}}]}] -->',
      '## Core Loop\nBody.',
    ].join('\n')));
    expect(result.tablePlans).toEqual([{ table: 'Skills', purpose: 'Actions.', fields: ['name'], rows: [{ name: 'Basic', values: { name: 'Basic' } }] }]);
    expect(result.markdown).not.toContain('KECO_TABLE_PLAN');
  });

  it('repairs missing table plans when KECO_TABLE_REF markers are present', async () => {
    const plan = {
      table: 'Products',
      purpose: 'Catalog.',
      fields: ['name'],
      rows: [{ name: 'Milk', values: { name: 'Milk' } }],
    };
    const complete = jest.fn(async () => {
      if (complete.mock.calls.length === 1) {
        return [
          '# GDD',
          '## Products',
          'Milk and bread.',
          '<!-- KECO_TABLE_REF Products -->',
          '## Core Loop',
          'Body.',
        ].join('\n');
      }
      return `<!-- KECO_TABLE_PLAN ${JSON.stringify([plan])} -->`;
    });

    const result = await generateGddMarkdownV2(input, complete);

    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.tablePlans).toEqual([plan]);
    expect(result.tablePlanWarning).toBeNull();
    expect(result.markdown).toContain('KECO_TABLE_REF Products');
    expect(result.review.repairRound).toBe(1);
  });

  it('starts dialogue planning as soon as a concrete scene event arrives in the GDD stream', async () => {
    const planScene = jest.fn(async ({ event }: { event: DialogueSceneEvent }) => scenePlan(event));
    async function* stream() {
      yield { type: 'text_delta' as const, content: `# GDD\n\n## Arrival\nConcrete scene.\n${sceneMarker(sceneEvent)}` };
      expect(planScene).toHaveBeenCalledTimes(1);
      yield { type: 'text_delta' as const, content: '\n\n## Systems\nThe remaining GDD.' };
      yield { type: 'finish' as const, reason: 'stop' };
    }

    const result = await generateGddMarkdownV2(input, { stream, planScene });

    expect(result.dialoguePlans).toEqual([scenePlan(sceneEvent)]);
    expect(result.markdown).not.toContain('KECO_DIALOGUE_SCENE');
    expect(result.markdown).toContain('## Systems');
  });

  it('instructs the model to emit scene events only for concrete interactive scenes', async () => {
    const complete = jest.fn(async () => '# GDD\n\n## Core Loop\nBody.');
    await generateGddMarkdownV2(input, complete);
    const messages = (complete.mock.calls[0] as unknown as [ChatMessage[]])[0];
    expect(messages[0].content).toMatch(/KECO_DIALOGUE_SCENE/i);
    expect(messages[0].content).toMatch(/chapterKey/i);
    expect(messages[0].content).toMatch(/immediately/i);
    expect(messages[0].content).toMatch(/concrete/i);
    expect(messages[0].content).toMatch(/abstract/i);
  });

  it('does not plan dialogue for an abstract NPC interaction feature statement', async () => {
    const planScene = jest.fn(async ({ event }: { event: DialogueSceneEvent }) => scenePlan(event));
    async function* stream() {
      yield { type: 'text_delta' as const, content: '# GDD\n\nThe game supports NPC interaction and branching choices.' };
      yield { type: 'finish' as const, reason: 'stop' };
    }

    const result = await generateGddMarkdownV2({ ...input, creativeBrief: undefined }, { stream, planScene });

    expect(result.dialoguePlans).toEqual([]);
    expect(planScene).not.toHaveBeenCalled();
  });

  it('runs at most three scene planners concurrently and preserves encounter order', async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const events = Array.from({ length: 4 }, (_, index) => ({
      ...sceneEvent,
      chapterKey: `scene-${index + 1}`,
      title: `Scene ${index + 1}`,
    }));
    const planScene = jest.fn(async ({ event }: { event: DialogueSceneEvent }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return scenePlan(event);
    });
    async function* stream() {
      yield { type: 'text_delta' as const, content: `# GDD\n${events.map(sceneMarker).join('\n')}\nComplete body.` };
      yield { type: 'finish' as const, reason: 'stop' };
    }

    const running = generateGddMarkdownV2(input, { stream, planScene });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(planScene).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(3);
    releases.shift()?.();
    for (let tick = 0; tick < 10 && planScene.mock.calls.length < 4; tick += 1) {
      await Promise.resolve();
    }
    expect(planScene).toHaveBeenCalledTimes(4);
    while (releases.length > 0) releases.shift()?.();

    const result = await running;
    expect(maxActive).toBe(3);
    expect(result.dialoguePlans.map((plan) => plan.chapterKey)).toEqual(events.map((event) => event.chapterKey));
  });

  it('aborts an active scene planner and returns no partial result', async () => {
    const controller = new AbortController();
    const planScene = jest.fn(async (
      _input: { event: DialogueSceneEvent },
      _dependencies: unknown,
      runtime: { signal?: AbortSignal },
    ) => new Promise<ReturnType<typeof scenePlan>>((resolve, reject) => {
      runtime.signal?.addEventListener('abort', () => reject(runtime.signal?.reason), { once: true });
      void resolve;
    }));
    async function* stream() {
      yield { type: 'text_delta' as const, content: `# GDD\nConcrete scene.\n${sceneMarker(sceneEvent)}\nComplete body.` };
      yield { type: 'finish' as const, reason: 'stop' };
    }

    const running = generateGddMarkdownV2(input, { stream, planScene }, { signal: controller.signal });
    for (let tick = 0; tick < 10 && planScene.mock.calls.length === 0; tick += 1) await Promise.resolve();
    controller.abort(new Error('Generation cancelled by user.'));

    await expect(running).rejects.toThrow('Generation cancelled by user.');
    expect(planScene).toHaveBeenCalledTimes(1);
  });

  it('extracts table plans while dialogue planning runs independently', async () => {
    const planScene = jest.fn(async ({ event }: { event: DialogueSceneEvent }) => scenePlan(event));
    async function* stream() {
      yield { type: 'text_delta' as const, content: [
        '# GDD',
        '## Arrival',
        'Concrete scene.',
        sceneMarker(sceneEvent),
        '<!-- KECO_TABLE_PLAN [{"table":"Skills","purpose":"Actions.","fields":["name"],"rows":[{"name":"Basic","values":{"name":"Basic"}}]}] -->',
        'Complete body.',
      ].join('\n') };
      yield { type: 'finish' as const, reason: 'stop' };
    }

    const result = await generateGddMarkdownV2(input, { stream, planScene });

    expect(result.dialoguePlans).toEqual([scenePlan(sceneEvent)]);
    expect(result.tablePlans).toEqual([{
      table: 'Skills', purpose: 'Actions.', fields: ['name'], rows: [{ name: 'Basic', values: { name: 'Basic' } }],
    }]);
  });

  it('does not pass hidden table-plan JSON into a later dialogue planner context', async () => {
    const planScene = jest.fn(async ({ event }: { event: DialogueSceneEvent }) => scenePlan(event));
    const tableMarker = '<!-- KECO_TABLE_PLAN [{"table":"Secret Table","purpose":"Internal","fields":["name"],"rows":[{"name":"Hidden","values":{"name":"Hidden"}}]}] -->';
    async function* stream() {
      yield { type: 'text_delta' as const, content: `# GDD\n${tableMarker}\n## Arrival\nConcrete scene.\n${sceneMarker(sceneEvent)}` };
      yield { type: 'finish' as const, reason: 'stop' };
    }

    await generateGddMarkdownV2(input, { stream, planScene });

    expect(JSON.stringify(planScene.mock.calls[0]?.[0])).not.toContain('Secret Table');
    expect(JSON.stringify(planScene.mock.calls[0]?.[0])).not.toContain('KECO_TABLE_PLAN');
  });

  it('escapes numeric less-than prose while preserving code', async () => {
    const result = await generateGddMarkdownV2(input, jest.fn(async () => [
      '# GDD',
      '',
      'Restock when inventory <5.',
      '',
      '`inventory <5`',
      '',
      '```text',
      'inventory <5',
      '```',
    ].join('\n')));

    expect(result.markdown).toContain('Restock when inventory &lt;5.');
    expect(result.markdown).toContain('`inventory <5`');
    expect(result.markdown).toContain('```text\ninventory <5\n```');
  });
});
