import { describe, expect, it } from '@jest/globals';
import { parseRuleSet } from './ruleSchema';
import { renderRuleSetMarkdown } from './ruleMarkdown';

describe('Game Design System Markdown boundary', () => {
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
