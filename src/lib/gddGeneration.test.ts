import {
  buildGddGenerationMessages,
  hashGddGenerationInput,
  parseGeneratedGdd,
  renderGddMarkdown,
  type GddGenerationInput,
} from './gddGeneration';

const rules = {
  schemaVersion: 1 as const,
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitableFor: 'Single-player tactical games',
  rules: [{
    id: 'readable-state',
    kind: 'principle' as const,
    title: 'Readable state',
    statement: 'Show decision inputs before commitment.',
    appliesWhen: 'Presenting a player choice.',
    severity: 'required' as const,
  }],
  tableGuidance: [{ table: 'Skills', purpose: 'Define reusable actions.', fields: ['name', 'cost'] }],
};

const input: GddGenerationInput = {
  projectId: '11111111-1111-4111-8111-111111111111',
  projectName: 'Harbor Tactics',
  designSystemId: '22222222-2222-4222-8222-222222222222',
  versionId: '33333333-3333-4333-8333-333333333333',
  versionNumber: 1,
  systemTitle: 'Tactical Systems',
  rules,
  designDocument: {
    designIntent: 'Make choices legible.',
    playerFantasy: 'Lead a small squad.',
    coreLoop: 'Scout, commit, resolve, adapt.',
    decisionStructure: 'Compare visible costs.',
    systemBoundaries: 'Never hide action costs.',
    progressionEconomy: 'Expand options before power.',
    contentModel: 'Use reusable entities.',
    difficultyBalance: 'Increase pressure through constraints.',
    experiencePresentation: 'Explain state changes.',
  },
  projectSources: [],
};

const generated = {
  title: 'Harbor Tactics GDD',
  overview: 'A tactical game about planning harbor defenses.',
  designIntent: 'Make every defense choice understandable.',
  playerFantasy: 'Lead a harbor defense crew.',
  coreLoop: 'Scout, plan, resolve, recover.',
  decisionStructure: 'Compare visible risks and costs.',
  gameplaySystems: 'Turn-based positioning and support actions.',
  contentModel: 'Characters, skills, encounters, and rewards.',
  progressionEconomy: 'Unlock new choices through captured supplies.',
  difficultyBalance: 'Add constraints before adding stat inflation.',
  narrativeWorld: 'A coastal settlement under pressure.',
  experiencePresentation: 'Preview consequences before commitment.',
  productionTables: [{ table: 'Skills', purpose: 'Reusable actions.', fields: ['name', 'cost'] }],
  assumptions: ['The project is single-player.'],
  appliedRuleIds: ['readable-state'],
};

describe('GDD generation contract', () => {
  it('parses a bounded generated GDD and validates applied rule IDs', () => {
    expect(parseGeneratedGdd(generated, rules).title).toBe('Harbor Tactics GDD');
    expect(() => parseGeneratedGdd({ ...generated, appliedRuleIds: ['unknown'] }, rules)).toThrow(/unknown rule/i);
  });

  it('rejects missing required fields and oversized output', () => {
    expect(() => parseGeneratedGdd({ ...generated, coreLoop: '' }, rules)).toThrow();
    expect(() => parseGeneratedGdd({ ...generated, assumptions: ['x'.repeat(2001)] }, rules)).toThrow();
  });

  it('renders deterministic GDD Markdown with assumptions and evidence', () => {
    const markdown = renderGddMarkdown(generated, { input });
    expect(markdown).toContain('# Harbor Tactics GDD');
    expect(markdown).toContain('## Assumptions to Confirm');
    expect(markdown).toContain('Applied rules: readable-state');
    expect(markdown.indexOf('## Core Loop')).toBeLessThan(markdown.indexOf('## Gameplay Systems'));
  });

  it('builds JSON-only generation messages from the pinned version and project context', () => {
    const messages = buildGddGenerationMessages(input);
    expect(messages[0].content).toContain('Return one JSON object only');
    expect(messages[1].content).toContain('Harbor Tactics');
    expect(messages[1].content).toContain('readable-state');
  });

  it('hashes equivalent inputs deterministically', () => {
    expect(hashGddGenerationInput(input)).toBe(hashGddGenerationInput(structuredClone(input)));
  });
});
