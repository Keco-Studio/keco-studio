import { describe, expect, it } from '@jest/globals';
import { renderGddV2Markdown } from './renderer';
import { countReadableCharacters, validateGddQuality } from './quality';
import type { DocumentV2 } from './contracts';

const document: DocumentV2 = {
  version: 2,
  id: 'warmth-gdd',
  title: 'Street-Corner Warmth',
  versionLabel: '1.0',
  gameType: 'Emotional companion simulation',
  targetPlatforms: ['Mobile', 'PC'],
  premise: 'The player meets stray cats on a city street corner and builds trust through patient, restrained companionship.',
  blueprint: { version: 2, nodes: [{ id: 'overview', label: 'Game Overview', depth: 0, group: 'core' }] },
  numericRegistry: { version: 2, entries: [{ id: 'bond.base', value: 5, label: 'Base Bond' }] },
  sections: [{
    id: 'overview', title: 'Game Overview', depth: 0, blocks: [
      { kind: 'paragraph', id: 'overview-p', text: 'A gentle companionship experience that still carries responsibility.' },
      { kind: 'flow', id: 'overview-flow', steps: [{ id: 'step-a', text: 'Enter the street corner' }, { id: 'step-b', text: 'Observe and interact' }] },
      { kind: 'data-table', id: 'overview-table', columns: ['Action', 'Base Value'], rows: [['Feed', '5']] },
      { kind: 'formula', id: 'overview-formula', expression: 'actual increment = base value × weather multiplier', numericRefs: ['bond.base'] },
      { kind: 'example', id: 'overview-example', title: 'Worked example', body: 'On a sunny day, feeding uses a base value of 5.', numericRefs: ['bond.base'] },
      { kind: 'quote', id: 'overview-quote', text: 'It was not raised by you; it chose you.', cite: 'Design philosophy' },
    ],
  }],
  assumptions: [],
};

describe('v2 GDD renderer and deterministic quality', () => {
  it('renders natural numbered Markdown blocks without provenance', () => {
    const markdown = renderGddV2Markdown(document);
    expect(markdown).toContain('# Street-Corner Warmth');
    expect(markdown).toContain('## 1. Game Overview');
    expect(markdown).toContain('| Action | Base Value |');
    expect(markdown).toContain('actual increment = base value × weather multiplier');
    expect(markdown).toContain('> —— Design philosophy');
    expect(markdown).not.toMatch(/Provenance/i);
  });

  it('renders assumptions only when present', () => {
    expect(renderGddV2Markdown(document)).not.toContain('Open Questions');
    expect(renderGddV2Markdown({ ...document, assumptions: ['Target platform is not confirmed yet.'] })).toContain('## Open Questions');
  });

  it('reports deterministic structural issues', () => {
    expect(countReadableCharacters(renderGddV2Markdown(document))).toBeGreaterThan(20);
    expect(validateGddQuality(document, 'professional')).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'length' }),
      expect.objectContaining({ code: 'section-count' }),
    ]));
    expect(validateGddQuality({ ...document, sections: [{ ...document.sections[0], blocks: [] }] }, 'quick'))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'empty-section' })]));
  });
});
