import { describe, expect, it } from '@jest/globals';
import { parseGameDesignDocument, parseRuleSet } from './ruleSchema';
import { renderRuleSetMarkdown } from './ruleMarkdown';

describe('Game Design System Markdown boundary', () => {
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
