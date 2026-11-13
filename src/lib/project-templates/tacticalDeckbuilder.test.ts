import { parseGameDesignDocument, parseRuleSet } from '@/lib/game-design-system/ruleSchema';
import { parseRetainedGameArtStyleSnapshot } from '@/lib/game-art-style/presets';
import { parseProjectTemplateManifest } from './schema';
import { tacticalDeckbuilderTemplate } from './tacticalDeckbuilder';

describe('tactical deckbuilder project template', () => {
  it('defines the complete version-one starter contract', () => {
    const manifest = parseProjectTemplateManifest(tacticalDeckbuilderTemplate);

    expect(manifest).toMatchObject({
      key: 'tactical-deckbuilder',
      version: 1,
      theme: 'Ashfall Tactics',
    });
    expect(manifest.folders.map((folder) => folder.key)).toEqual([
      'game-design',
      'cards-combat',
      'content',
    ]);
    expect(manifest.tables.map((table) => [table.key, table.rows.length])).toEqual([
      ['cards', 12],
      ['keywords', 5],
      ['heroes', 2],
      ['enemies', 4],
      ['encounters', 3],
      ['rewards', 4],
    ]);
    expect(manifest.assets).toEqual([]);
    expect(parseRuleSet(manifest.gds.rules)).toEqual(manifest.gds.rules);
    expect(parseGameDesignDocument(manifest.gds.document)).toEqual(manifest.gds.document);
    expect(parseRetainedGameArtStyleSnapshot(manifest.gds.artStyle)).toEqual(manifest.gds.artStyle);
  });

  it('rejects duplicate logical keys and dangling row references', () => {
    const deferredAsset = {
      key: 'asset.deferred',
      fileName: 'deferred.png',
      displayName: 'Deferred Art',
      category: 'media' as const,
      mimeType: 'image/png' as const,
    };
    expect(() => parseProjectTemplateManifest({
      ...tacticalDeckbuilderTemplate,
      assets: [deferredAsset, deferredAsset],
    })).toThrow(/duplicate asset key/i);

    const heroes = tacticalDeckbuilderTemplate.tables.find((table) => table.key === 'heroes')!;
    expect(() => parseProjectTemplateManifest({
      ...tacticalDeckbuilderTemplate,
      tables: tacticalDeckbuilderTemplate.tables.map((table) => table.key === 'heroes'
        ? {
            ...table,
            rows: [
              {
                ...heroes.rows[0],
                values: {
                  ...heroes.rows[0].values,
                  startingDeck: { rowRefs: ['card.missing'] },
                },
              },
              ...heroes.rows.slice(1),
            ],
          }
        : table),
    })).toThrow(/card\.missing/i);
  });

});
