import { describe, expect, it, jest } from '@jest/globals';
jest.mock('server-only', () => ({}));
import {
  buildBlueprintMessages,
  generateGddBlueprint,
  generateGddMarkdownV2,
  generateGddV2,
  generateSectionBatch,
  GddV2GenerationValidationError,
  repairGddSections,
  reviewGddDocument,
} from './generator';
import type { ChatMessage } from '@/lib/agent/types';
import type { GddGenerationRequestV2 } from './contracts';

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
    designIntent: 'Use patient care to create emotional weight.', playerFantasy: 'Be chosen by a wary animal.',
    coreLoop: 'Explore, observe, interact, and return.', decisionStructure: 'Spend limited daily actions.',
    systemBoundaries: 'No forced purchases.', progressionEconomy: 'Trust unlocks behavior.',
    contentModel: 'Cats, places, weather, interactions.', difficultyBalance: 'Weather adds pressure.',
    experiencePresentation: 'Warm watercolor scenes.',
  },
  artStyle: null,
  projectSources: [],
};

const blueprint = {
  version: 2 as const,
  nodes: [
    { id: 'overview', label: 'Game Overview', depth: 0, group: 'core' },
    { id: 'systems', label: 'Systems', depth: 0, group: 'systems' },
    { id: 'presentation', label: 'Presentation', depth: 0, group: 'content' },
  ],
};

describe('GDD v2 staged generator', () => {
  it('generates production Markdown in one completion without JSON parsing or model review', async () => {
    const markdown = [
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
      'Enter the map → Choose a location → Meet a cat → Interact → Advance time.',
      '```',
    ].join('\n');
    const complete = jest.fn(async () => markdown);

    const result = await generateGddMarkdownV2({ ...input, mode: 'quick' }, complete);

    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.markdown).toContain('# Street-Corner Warmth: Stray Bonds');
    expect(result.markdown).toContain('## Core Loop');
    expect(result.markdown).not.toContain('```');
    expect(result.markdown).not.toMatch(/provenance/i);
    expect(result.review).toMatchObject({ status: 'pass', issues: [] });
  });

  it('asks professional direct generation for a bounded executable Markdown GDD', async () => {
    const complete = jest.fn(async () => '# GDD\n\n## Game Overview\nBody text.');

    await generateGddMarkdownV2(input, complete);

    const messages = (complete.mock.calls[0] as unknown as [ChatMessage[]])[0];
    expect(messages[0].content).toContain('Return the finished GDD as Markdown directly');
    expect(messages[0].content).toContain('6,000-9,000 readable Chinese characters');
    expect(messages[0].content).toContain('Do not return JSON');
    expect(messages[0].content).toContain('calculate every worked example before writing it');
  });

  it('builds a professional adaptive blueprint prompt with the creative brief', () => {
    const messages = buildBlueprintMessages(input);
    expect(messages[0].content).toContain('9 to 13 first-level sections');
    expect(messages[0].content).toContain('Do not add a production milestone section');
    expect(messages[0].content).toContain('hyphens, underscores, or dots');
    expect(messages[0].content).toContain('numericRegistry IDs and numericRefs must use lowercase ASCII identifiers');
    expect(messages[0].content).toContain('Register every gameplay number exactly once');
    expect(messages[0].content).toContain('Omit optional properties when unknown; never use null');
    expect(messages[1].content).toContain(input.creativeBrief);
    expect(messages[1].content).toContain('BEGIN_UNTRUSTED_GAME_DESIGN_DOCUMENT_DATA');
    expect(messages[1].content).toContain('No project Documents or Tables are available.');
  });

  it('repairs one malformed blueprint response', async () => {
    const complete = jest.fn(async () => complete.mock.calls.length === 1 ? 'not-json' : JSON.stringify(blueprint));
    await expect(generateGddBlueprint(input, complete)).resolves.toEqual(blueprint);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('accepts a JSON response wrapped in a Markdown code fence', async () => {
    const complete = jest.fn(async () => `\`\`\`json\n${JSON.stringify(blueprint)}\n\`\`\``);

    await expect(generateGddBlueprint(input, complete)).resolves.toEqual(blueprint);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('accepts complete JSON after an opening code fence without a closing fence', async () => {
    const complete = jest.fn(async () => `\`\`\`json\n${JSON.stringify(blueprint)}`);

    await expect(generateGddBlueprint(input, complete)).resolves.toEqual(blueprint);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('generates only the requested section group', async () => {
    const sections = [{ id: 'systems', title: 'Systems', depth: 0, group: 'systems', blocks: [{ kind: 'paragraph', id: 'systems-p', text: 'Systems body.' }], numericRefs: [] }];
    const complete = jest.fn(async () => JSON.stringify(sections));
    await expect(generateSectionBatch(input, blueprint, 'systems', complete)).resolves.toEqual(sections);
    const requestMessages = ((complete.mock.calls[0] as unknown as [Array<{ content: string }>])[0]);
    const prompt = requestMessages[1].content;
    expect(requestMessages[0].content).toContain('Use "kind", never "type"');
    expect(requestMessages[0].content).toContain('Allowed ID separators are dot, hyphen, and underscore');
    expect(requestMessages[0].content).toContain('Every quantitative statement and worked example must be recalculated');
    expect(requestMessages[0].content).toContain('2,000-3,000 Chinese characters');
    expect(requestMessages[0].content).toContain('omit parentId entirely for depth 0 sections');
    expect(requestMessages[0].content).toContain('{"kind":"paragraph","id":"block-id","text":"..."}');
    expect(prompt).toContain('"id":"systems"');
    expect(prompt).not.toContain('Write only these nodes:\n[{"id":"overview"');
  });

  it('keeps transport errors retryable and fails after two invalid schema responses', async () => {
    const transport = new Error('network');
    await expect(generateGddBlueprint(input, jest.fn(async () => { throw transport; }))).rejects.toBe(transport);
    await expect(generateGddBlueprint(input, jest.fn(async () => '{}'))).rejects.toBeInstanceOf(GddV2GenerationValidationError);
  });

  it('caps professional generation at two bounded section drafts, one review, and one repair', async () => {
    const groups = ['core', 'systems', 'content'] as const;
    const nodes = groups.flatMap((group) => [1, 2, 3].map((index) => ({
      id: `${group}-${index}`,
      label: `${group}-${index}`,
      depth: 0,
      group,
    })));
    const professionalBlueprint = {
      version: 2 as const,
      title: 'Complete GDD',
      numericRegistry: [],
      nodes,
    };
    const sections = nodes.map((node) => ({
      id: node.id,
      title: node.label,
      depth: 0,
      group: node.group,
      blocks: [{
        kind: 'paragraph' as const,
        id: `${node.id}-paragraph`,
        text: `${node.id}${'complete design content'.repeat(120)}`,
      }],
      numericRefs: [],
    }));
    const unresolvedReview = {
      version: 2 as const,
      summary: 'The draft is usable and can still be polished.',
      status: 'repair' as const,
      issues: [{
        id: 'issue-warning',
        severity: 'error' as const,
        sectionId: 'systems-1',
        message: 'Boundary notes can be more specific.',
        repairInstruction: 'Add boundary notes.',
      }],
    };
    let reviewCalls = 0;
    let repairCalls = 0;
    let sectionCalls = 0;
    const sectionPrompts: string[] = [];
    const complete = jest.fn(async (messages: ChatMessage[]) => {
      const system = typeof messages[0].content === 'string' ? messages[0].content : '';
      if (system.includes('lead game designer planning')) return JSON.stringify(professionalBlueprint);
      if (system.includes('writing the core, systems section groups')) {
        sectionCalls += 1;
        sectionPrompts.push(typeof messages[1].content === 'string' ? messages[1].content : '');
        return JSON.stringify(sections.filter((section) => section.group !== 'content'));
      }
      if (system.includes('writing the content section group')) {
        sectionCalls += 1;
        sectionPrompts.push(typeof messages[1].content === 'string' ? messages[1].content : '');
        return JSON.stringify(sections.filter((section) => section.group === 'content'));
      }
      if (system.includes('Review a complete GDD')) {
        reviewCalls += 1;
        return JSON.stringify(unresolvedReview);
      }
      if (system.includes('Repair only the named GDD sections')) {
        repairCalls += 1;
        return JSON.stringify(sections.filter((section) => section.id === 'systems-1'));
      }
      throw new Error('Unexpected completion stage.');
    });

    await expect(generateGddV2(input, complete)).resolves.toMatchObject({
      document: { title: 'Complete GDD' },
      review: unresolvedReview,
    });
    expect(sectionCalls).toBe(2);
    expect(reviewCalls).toBe(1);
    expect(repairCalls).toBe(1);
    expect(sectionPrompts[0]).toContain('"id":"core-1"');
    expect(sectionPrompts[0]).toContain('"id":"systems-1"');
    expect(sectionPrompts[1]).toContain('"id":"content-1"');
    expect(sectionPrompts[1]).toContain('Previously generated canonical sections:');
    expect(sectionPrompts[1]).toContain('"id":"systems-1"');
  });

  it('gives section repair the complete document for cross-section consistency', async () => {
    const sections = blueprint.nodes.map((node) => ({
      id: node.id,
      title: node.label,
      depth: 0,
      group: node.group,
      blocks: [{ kind: 'paragraph' as const, id: `${node.id}-p`, text: `${node.label} body.` }],
      numericRefs: [],
    }));
    const document = {
      version: 2 as const,
      id: 'test-gdd',
      title: 'Cross-section repair test',
      blueprint,
      numericRegistry: { version: 2 as const, entries: [] },
      sections,
    };
    const report = {
      version: 2 as const,
      summary: 'The systems section duplicates the overview.',
      status: 'repair' as const,
      issues: [{
        id: 'duplicate-warning',
        severity: 'warning' as const,
        sectionId: 'systems',
        message: 'Duplicate content.',
        repairInstruction: 'Remove duplicate content using the full document.',
      }],
    };
    const complete = jest.fn(async () => JSON.stringify(sections.filter((section) => section.id === 'systems')));

    await repairGddSections(input, blueprint, document, report, complete);

    const requestMessages = ((complete.mock.calls[0] as unknown as [Array<{ content: string }>])[0]);
    expect(requestMessages[1].content).toContain('Full document for cross-section consistency:');
    expect(requestMessages[1].content).toContain('"title":"Cross-section repair test"');
  });

  it('limits blocking review findings to material design errors', async () => {
    const document = {
      version: 2 as const,
      id: 'review-test-gdd',
      title: 'Review test',
      blueprint,
      numericRegistry: { version: 2 as const, entries: [] },
      sections: [{
        id: 'overview',
        title: 'Game Overview',
        depth: 0,
        group: 'core',
        blocks: [{ kind: 'paragraph' as const, id: 'overview-p', text: 'Complete body.' }],
        numericRefs: [],
      }],
    };
    const complete = jest.fn(async () => JSON.stringify({
      version: 2,
      summary: 'Can pass.',
      status: 'pass',
      issues: [],
    }));

    await reviewGddDocument(input, blueprint, document, [], complete);

    const requestMessages = ((complete.mock.calls[0] as unknown as [Array<{ content: string }>])[0]);
    expect(requestMessages[0].content).toContain('Advisory polish warnings do not block pass');
    expect(requestMessages[0].content).toContain('Reserve severity error for material contradictions');
    expect(requestMessages[1].content).toContain('Frozen source context:');
    expect(requestMessages[1].content).toContain('BEGIN_UNTRUSTED_GAME_DESIGN_DOCUMENT_DATA');
  });

  it('requires repair output to contain every targeted section', async () => {
    const sections = blueprint.nodes.map((node) => ({
      id: node.id,
      title: node.label,
      depth: 0,
      group: node.group,
      blocks: [{ kind: 'paragraph' as const, id: `${node.id}-p`, text: `${node.label} body.` }],
      numericRefs: [],
    }));
    const document = {
      version: 2 as const,
      id: 'repair-target-gdd',
      title: 'Repair target test',
      blueprint,
      numericRegistry: { version: 2 as const, entries: [] },
      sections,
    };
    const report = {
      version: 2 as const,
      summary: 'Two sections need repair.',
      status: 'repair' as const,
      issues: [
        { id: 'systems-warning', severity: 'warning' as const, sectionId: 'systems', message: 'Add rules.', repairInstruction: 'Add rules.' },
        { id: 'presentation-warning', severity: 'warning' as const, sectionId: 'presentation', message: 'Reduce duplication.', repairInstruction: 'Reduce duplication.' },
      ],
    };
    const targets = sections.filter((section) => section.id === 'systems' || section.id === 'presentation');
    const complete = jest.fn(async () => JSON.stringify(complete.mock.calls.length === 1 ? targets.slice(0, 1) : targets));

    await expect(repairGddSections(input, blueprint, document, report, complete)).resolves.toEqual(targets);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('repairs the whole document when review reports many consistency problems', async () => {
    const sections = blueprint.nodes.map((node) => ({
      id: node.id,
      title: node.label,
      depth: 0,
      group: node.group,
      blocks: [{ kind: 'paragraph' as const, id: `${node.id}-p`, text: `${node.label} body.` }],
      numericRefs: [],
    }));
    const document = {
      version: 2 as const,
      id: 'global-repair-gdd',
      title: 'Global repair test',
      blueprint,
      numericRegistry: { version: 2 as const, entries: [] },
      sections,
    };
    const report = {
      version: 2 as const,
      summary: 'There are multiple cross-section conflicts.',
      status: 'repair' as const,
      issues: [
        { id: 'issue-1', severity: 'error' as const, sectionId: 'systems', message: 'Numeric conflict.', repairInstruction: 'Align the numbers.' },
        { id: 'issue-2', severity: 'error' as const, sectionId: 'systems', message: 'Incorrect example.', repairInstruction: 'Recalculate the example.' },
        { id: 'issue-3', severity: 'warning' as const, sectionId: 'presentation', message: 'Terminology conflict.', repairInstruction: 'Unify terminology.' },
        { id: 'issue-4', severity: 'warning' as const, sectionId: 'systems', message: 'Content is too long.', repairInstruction: 'Remove duplication.' },
      ],
    };
    const complete = jest.fn(async () => JSON.stringify(sections));

    await expect(repairGddSections(input, blueprint, document, report, complete)).resolves.toEqual(sections);

    const requestMessages = ((complete.mock.calls[0] as unknown as [Array<{ content: string }>])[0]);
    expect(requestMessages[0].content).toContain('whole-document consistency repair');
    expect(requestMessages[1].content).toContain('"id":"overview"');
    expect(requestMessages[1].content).toContain('"id":"presentation"');
  });

  it('generates quick mode in one model completion without model review', async () => {
    const quickInput = { ...input, mode: 'quick' as const };
    const quickBlueprint = {
      version: 2 as const,
      title: 'Quick GDD',
      numericRegistry: [],
      nodes: [{ id: 'overview', label: 'Game Overview', depth: 0, group: 'core' }],
    };
    const section = {
      id: 'overview',
      title: 'Game Overview',
      depth: 0,
      group: 'core',
      blocks: [{ kind: 'paragraph' as const, id: 'overview-p', text: 'Complete body.' }],
      numericRefs: [],
    };
    const document = {
      version: 2 as const,
      id: 'quick-gdd',
      title: 'Quick GDD',
      blueprint: quickBlueprint,
      numericRegistry: { version: 2 as const, entries: [] },
      sections: [section],
    };
    const complete = jest.fn(async (messages: ChatMessage[]) => {
      const system = typeof messages[0].content === 'string' ? messages[0].content : '';
      if (system.includes('Create a compact structured GDD in one pass')) return JSON.stringify(document);
      throw new Error('Unexpected completion stage.');
    });

    await expect(generateGddV2(quickInput, complete)).resolves.toMatchObject({
      document: { id: 'quick-gdd' },
      review: { status: 'pass' },
    });
    expect(complete).toHaveBeenCalledTimes(1);
    const requestMessages = ((complete.mock.calls[0] as unknown as [Array<{ content: string }>])[0]);
    expect(requestMessages[0].content).toContain('silently check terminology, numbers, formulas, examples, and assumptions');
    expect(requestMessages[0].content).toContain('The embedded blueprint and numericRegistry must be canonical');
  });

  it('normalizes compact quick blueprint node aliases without another model call', async () => {
    const quickInput = { ...input, mode: 'quick' as const };
    const response = {
      version: 2,
      id: 'quick-gdd',
      title: 'Quick GDD',
      blueprint: {
        version: 2,
        nodes: [{ id: 'overview', title: 'Game Overview', description: 'Blueprint summary', fields: ['Goal'] }],
      },
      numericRegistry: { version: 2, entries: [] },
      sections: [{
        id: 'overview', title: 'Game Overview', depth: 0, group: 'core',
        blocks: [{ kind: 'paragraph', id: 'overview-p', text: 'Complete body.' }], numericRefs: [],
      }],
    };
    const complete = jest.fn(async () => JSON.stringify(response));

    await expect(generateGddV2(quickInput, complete)).resolves.toMatchObject({
      document: {
        blueprint: { nodes: [{ id: 'overview', label: 'Game Overview', depth: 0, group: 'core' }] },
      },
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('still rejects deterministic structural quality failures', async () => {
    const quickInput = { ...input, mode: 'quick' as const };
    const quickBlueprint = {
      version: 2 as const,
      title: 'Broken GDD',
      numericRegistry: [],
      nodes: [{ id: 'overview', label: 'Game Overview', depth: 0, group: 'core' }],
    };
    const document = {
      version: 2 as const,
      id: 'broken-gdd',
      title: 'Broken GDD',
      blueprint: quickBlueprint,
      numericRegistry: { version: 2 as const, entries: [] },
      sections: [{ id: 'overview', title: 'Game Overview', depth: 0, group: 'core', blocks: [], numericRefs: [] }],
    };
    const complete = jest.fn(async (messages: ChatMessage[]) => {
      const system = typeof messages[0].content === 'string' ? messages[0].content : '';
      if (system.includes('Create a compact structured GDD in one pass')) return JSON.stringify(document);
      throw new Error('Unexpected completion stage.');
    });

    await expect(generateGddV2(quickInput, complete)).rejects.toThrow('Quick GDD failed deterministic quality gate');
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
