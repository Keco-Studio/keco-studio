import { describe, expect, it } from '@jest/globals';
import { parseGameDesignDocument, parseRuleSet } from './ruleSchema';
import { renderRuleSetMarkdown } from './ruleMarkdown';

describe('Game Design System Markdown boundary', () => {
  it('groups v2 gameplay rules by domain and then kind without changing v1 headings', () => {
    const rules = parseRuleSet({
      schemaVersion: 2,
      genres: ['Strategy'],
      philosophies: ['Readable Systems'],
      suitableFor: 'Tactical games',
      rules: [
        ['player', 'principle'],
        ['objective', 'check'],
        ['action', 'constraint'],
        ['object_state', 'pattern'],
        ['sequence', 'constraint'],
        ['resource_cost', 'constraint'],
        ['resolution_feedback', 'check'],
        ['fallback', 'anti_pattern'],
      ].map(([domain, kind]) => ({
        id: `${domain.replaceAll('_', '-')}-rule`,
        domain,
        kind,
        title: `${domain} rule`,
        statement: `Define ${domain}.`,
        appliesWhen: 'Resolving gameplay.',
        severity: 'required',
      })),
      tableGuidance: [],
    });
    const legacy = parseRuleSet({
      schemaVersion: 1,
      genres: ['Strategy'],
      philosophies: ['Readable Systems'],
      suitableFor: 'Tactical games',
      rules: [{
        id: 'legacy-constraint',
        kind: 'constraint',
        title: 'Legacy constraint',
        statement: 'Keep the old structure.',
        appliesWhen: 'Reviewing a v1 system.',
        severity: 'required',
      }, {
        id: 'legacy-principle',
        kind: 'principle',
        title: 'Legacy principle',
        statement: 'Render by kind.',
        appliesWhen: 'Reviewing a v1 system.',
        severity: 'required',
      }],
      tableGuidance: [],
    });

    const markdown = renderRuleSetMarkdown(rules, { title: 'Gameplay kernel', version: 2 });
    const legacyMarkdown = renderRuleSetMarkdown(legacy, { title: 'Legacy rules', version: 1 });

    expect(markdown).toContain('## Actions');
    expect(markdown).toContain('## Resource Costs');
    expect(markdown).toContain('### Constraints');
    expect(markdown).toContain('#### action-rule - action rule');
    expect(markdown).not.toMatch(/^### action-rule - action rule$/m);
    expect(markdown.indexOf('## Actions')).toBeLessThan(markdown.indexOf('## Resource Costs'));
    expect(markdown.indexOf('## Keco Table Guidance')).toBeGreaterThan(markdown.indexOf('## Fallbacks'));
    expect(legacyMarkdown).toContain('## Principles');
    expect(legacyMarkdown).toContain('## Constraints');
    expect(legacyMarkdown).toContain('### legacy-principle - Legacy principle');
    expect(legacyMarkdown).not.toMatch(/^#### legacy-principle - Legacy principle$/m);
    expect(legacyMarkdown.indexOf('## Principles')).toBeLessThan(legacyMarkdown.indexOf('## Constraints'));
    expect(legacyMarkdown).not.toContain('## Players');
  });

  it('renders the game background section only when the document includes one', () => {
    const rules = parseRuleSet({
      schemaVersion: 1,
      genres: ['Strategy'],
      philosophies: ['Readable Systems'],
      suitableFor: 'Tactical games',
      rules: [{
        id: 'readable-state',
        kind: 'principle',
        title: 'Readable state',
        statement: 'Expose decision inputs.',
        appliesWhen: 'Presenting choices.',
        severity: 'required',
      }],
      tableGuidance: [],
    });
    const document = parseGameDesignDocument({
      designIntent: 'Make tactical choices clear.',
      playerFantasy: 'Lead a small squad.',
      coreLoop: 'Scout, commit, resolve, adapt.',
      decisionStructure: 'Compare visible costs.',
      systemBoundaries: 'Never hide action costs.',
      progressionEconomy: 'Expand tactical options.',
      contentModel: 'Use reusable entities.',
      difficultyBalance: 'Increase pressure through constraints.',
      experiencePresentation: 'Explain state changes.',
    });
    const background = 'A river kingdom recovering from a magical flood.';

    const legacyMarkdown = renderRuleSetMarkdown(rules, { title: 'Tactical Rules', version: 1, document });
    const versionedMarkdown = renderRuleSetMarkdown(rules, {
      title: 'Tactical Rules',
      version: 1,
      document: parseGameDesignDocument({ ...document, gameBackground: background }),
    });

    expect(legacyMarkdown).not.toContain('## Game Background & Setting');
    expect(versionedMarkdown).toContain('## Game Background & Setting');
    expect(versionedMarkdown).toContain(background);
    expect(versionedMarkdown.indexOf('## Game Background & Setting')).toBeLessThan(versionedMarkdown.indexOf('## Design Intent & Player Fantasy'));
  });

  it('renders only document and rule data when Art Style metadata is present', () => {
    const rules = parseRuleSet({
      schemaVersion: 1,
      genres: ['Strategy'],
      philosophies: ['Readable Systems'],
      suitableFor: 'Tactical games',
      rules: [{
        id: 'readable-state',
        kind: 'principle',
        title: 'Readable state',
        statement: 'Expose decision inputs.',
        appliesWhen: 'Presenting choices.',
        severity: 'required',
      }],
      tableGuidance: [],
    });
    const metadata = { title: 'Tactical Rules', version: 1 };
    const metadataWithArtStyle = {
      ...metadata,
      artStyle: {
        title: 'ART_STYLE_MARKDOWN_LEAK',
        specification: { visualIdentity: 'ART_SPECIFICATION_MARKDOWN_LEAK' },
        customization: { direction: 'ART_DIRECTION_MARKDOWN_LEAK' },
      },
    };

    const baseline = renderRuleSetMarkdown(rules, metadata);
    const markdown = renderRuleSetMarkdown(rules, metadataWithArtStyle);

    expect(markdown).toBe(baseline);
    expect(markdown).not.toContain('ART_STYLE_MARKDOWN_LEAK');
    expect(markdown).not.toContain('ART_SPECIFICATION_MARKDOWN_LEAK');
    expect(markdown).not.toContain('ART_DIRECTION_MARKDOWN_LEAK');
  });
});
