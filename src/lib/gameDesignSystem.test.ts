import { describe, expect, it } from '@jest/globals';
import {
  buildGameDesignSystemMarkdown,
  buildGameDesignSystemMessages,
  normalizeGameDesignSystemInput,
  type GameDesignSystemInput,
} from '@/lib/gameDesignSystem';

const input: GameDesignSystemInput = {
  title: 'Tactical Deckbuilder',
  genres: ['Strategy', 'Deckbuilder'],
  philosophies: ['Meaningful Decisions', 'Readable Systems'],
  description: 'A run-based tactical card game with clear tradeoffs.',
  suitableFor: 'Single-player, run-based campaigns',
  referenceGames: [
    { name: 'Into the Breach', reference: 'Readable tactical choices', avoid: 'Do not copy its map scale' },
  ],
  references: [
    { kind: 'document', label: 'Combat GDD', projectId: 'project-1', resourceId: 'doc-1' },
  ],
};

describe('game design system core contract', () => {
  it('normalizes empty optional input without losing the core selections', () => {
    expect(normalizeGameDesignSystemInput({
      title: '  Tactical Deckbuilder  ',
      genres: ['Strategy', 'Strategy', ''],
      philosophies: ['Meaningful Decisions'],
      description: '  ',
    })).toEqual({
      title: 'Tactical Deckbuilder',
      genres: ['Strategy'],
      philosophies: ['Meaningful Decisions'],
      description: undefined,
      suitableFor: undefined,
      referenceGames: [],
      references: [],
      baseSystemId: undefined,
      pastedMarkdown: undefined,
    });
  });

  it('builds the required flat markdown sections and preserves provenance', () => {
    const markdown = buildGameDesignSystemMarkdown(input);
    expect(markdown).toContain('# Tactical Deckbuilder');
    expect(markdown).toContain('> Genre: Strategy, Deckbuilder');
    expect(markdown).toContain('## 11. Keco Table Guidance');
    expect(markdown).toContain('Into the Breach');
    expect(markdown).toContain('Combat GDD');
    expect(markdown).toContain('Do not copy its map scale');
  });

  it('builds a DeepSeek prompt that requires markdown only and includes source context', () => {
    const messages = buildGameDesignSystemMessages(input);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('GAME_DESIGN_SYSTEM.md');
    expect(messages[1].content).toContain('Tactical Deckbuilder');
    expect(messages[1].content).toContain('Combat GDD');
    expect(messages[1].content).toContain('Return only Markdown');
  });
});
