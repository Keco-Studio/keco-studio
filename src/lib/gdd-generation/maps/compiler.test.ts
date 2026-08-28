import { describe, expect, it, jest } from '@jest/globals';
jest.mock('server-only', () => ({}));
import type { GameArtStyleSnapshot } from '@/lib/game-art-style/schema';
import {
  buildGddMapBriefMessages,
  compileGddMapBriefs,
  compileGddMapStyleContract,
} from './compiler';

const style = {
  schemaVersion: 1,
  presetId: 'cozy-pixel',
  presetVersion: 2,
  title: 'Cozy Pixel',
  previewAssetSet: {
    id: 'cozy-pixel-preview',
    map: { sourcePath: 'public/game-art-styles/cozy-map.png', publicPath: '/game-art-styles/cozy-map.png', width: 1, height: 1, alt: 'map', sha256: 'a'.repeat(64), bytes: 1, alpha: 'opaque' },
    character: { sourcePath: 'public/game-art-styles/cozy-character.png', publicPath: '/game-art-styles/cozy-character.png', width: 1, height: 1, alt: 'character', sha256: 'b'.repeat(64), bytes: 1, alpha: 'transparent' },
    supporting: [],
  },
  specification: {
    visualIdentity: 'Warm readable pixel art.', pixelTechnique: 'Crisp clusters.', shapeLanguage: 'Soft chunky silhouettes.',
    paletteAndLighting: 'Moss green and amber light.', characterDirection: 'Readable figures.', environmentDirection: 'Top-down spaces.',
    propDirection: 'Simple props.', effectsDirection: 'Small effects.', uiHudDirection: 'Clear UI.', animationDirection: 'Short loops.', accessibility: 'High contrast.',
  },
  customization: {
    direction: 'Keep maps welcoming.', referenceGames: [{ name: 'Example', borrow: 'Readable routes' }], avoid: 'No photorealism.',
  },
} as GameArtStyleSnapshot;

function candidate(title: string, sourceHeading: string, priority = 0) {
  return {
    title, mapType: 'region', sourceHeading, purpose: `${title} purpose`, spatialLayout: 'A connected top-down layout.',
    regions: ['North'], routes: ['Main road'], landmarks: ['Gate'], gameplayRequirements: ['Readable traversal'],
    visualDescription: 'Warm pixel map.', outputSize: '512x512', priority,
    createMapDescription: 'Top-down pixel-art map with clear terrain, routes, and landmarks.',
  };
}

describe('GDD map brief compiler', () => {
  it('lets the map extraction agent return no maps when the GDD has no map', async () => {
    const complete = jest.fn(async () => '[]');
    await expect(compileGddMapBriefs({ markdown: '# Core Loop\nA character explores a forest.', artStyle: null, complete })).resolves.toEqual([]);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('does not treat map UI feedback as a spatial map description', async () => {
    const markdown = '# Consequence Feedback\n| Change | Presentation | Example |\n| --- | --- | --- |\n| World state | \u5730\u56fe\u754c\u9762\u66f4\u65b0 | \u5341\u5b57\u9547\u533a\u57df\u56fe\u6807\u53d8\u4e3a\u94c1\u8a93\u63a7\u5236 |';
    const complete = jest.fn(async () => '[]');
    await expect(compileGddMapBriefs({ markdown, artStyle: null, complete })).resolves.toEqual([]);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('keeps exact headings, assigns server IDs, and freezes the shared style contract', async () => {
    const complete = jest.fn(async () => JSON.stringify([candidate('Harbor', 'World Map')]));
    const result = await compileGddMapBriefs({ markdown: '# World Map\nThe harbor route connects the regions.', artStyle: style, complete });
    expect(result).toHaveLength(1);
    expect(result[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result[0].styleContract).toEqual(compileGddMapStyleContract(style));
    expect(result[0].styleContract?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result[0].styleContract?.sourceArtStyleVersion).toBe(2);
    expect(buildGddMapBriefMessages('# World Map', result[0].styleContract)[0].content).toContain('Do not infer a map');
    expect(buildGddMapBriefMessages('# World Map', result[0].styleContract)[0].content).toContain('"mapType":"world|region|level|settlement|interior|other"');
    expect(buildGddMapBriefMessages('# World Map', result[0].styleContract)[0].content).toContain('624x416');
    expect(buildGddMapBriefMessages('# World Map', result[0].styleContract)[0].content).toContain('384x688');
    expect(buildGddMapBriefMessages('# World Map', result[0].styleContract)[0].content).toContain('arrays of plain strings');
  });

  it('selects the three highest-priority candidates when four are returned', async () => {
    const complete = jest.fn(async () => JSON.stringify([
      candidate('First', 'Map One', 1), candidate('Second', 'Map Two', 4),
      candidate('Third', 'Map Three', 2), candidate('Fourth', 'Map Four', 9),
    ]));
    const result = await compileGddMapBriefs({
      markdown: '# Map One\n# Map Two\n# Map Three\n# Map Four\n\nMap layout includes four regions.', artStyle: null, complete,
    });
    expect(result.map((brief) => brief.title)).toEqual(['Fourth', 'Second', 'Third']);
  });

  it('repairs malformed structured output once', async () => {
    const complete = jest.fn(async (_messages: unknown[], _options?: unknown) => '{not json')
      .mockResolvedValueOnce('{not json')
      .mockResolvedValueOnce(JSON.stringify([candidate('Harbor', 'Map')]));
    const result = await compileGddMapBriefs({ markdown: '# Map\nA map layout.', artStyle: null, complete });
    expect(result).toHaveLength(1);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('gives schema-incompatible output an exact repair contract', async () => {
    const incompatible = JSON.stringify([{
      title: 'Harbor', sourceHeading: 'Map', purpose: 'Traversal', spatialLayout: 'Three zones.',
      regions: [{ name: 'North' }], routes: [{ from: 'North', to: 'South' }], landmarks: ['Gate'],
      gameplayRequirements: ['Readable'], visualDescription: 'Top-down map.', outputSize: '512x512',
      priority: 1, createMapDescription: 'Top-down map.',
    }]);
    const complete = jest.fn(async () => incompatible)
      .mockResolvedValueOnce(incompatible)
      .mockResolvedValueOnce(JSON.stringify([candidate('Harbor', 'Map')]));

    await expect(compileGddMapBriefs({ markdown: '# Map\nA map layout.', artStyle: null, complete })).resolves.toHaveLength(1);

    const repairMessages = (complete.mock.calls[1] as unknown as [Array<{ content: string }>])[0];
    expect(repairMessages[1].content).toContain('Every field in the required shape is mandatory');
    expect(repairMessages[1].content).toContain('"regions":["..."]');
    expect(repairMessages[1].content).toContain('flatten object values into concise strings');
  });

  it('rejects model-invented source headings', async () => {
    const complete = jest.fn(async () => JSON.stringify([candidate('Invented', 'Not In GDD')]));
    await expect(compileGddMapBriefs({ markdown: '# Map\nA map layout.', artStyle: null, complete })).resolves.toEqual([]);
  });

  it.each([
    '\u57fa\u7840\u5730\u56fe\u63cf\u8ff0',
    '### 10. \u57fa\u7840\u5730\u56fe\u63cf\u8ff0',
  ])('maps model heading variant %s back to the exact numbered GDD heading', async (sourceHeading) => {
    const complete = jest.fn(async () => JSON.stringify([candidate('Town', sourceHeading)]));
    const result = await compileGddMapBriefs({
      markdown: '## 10. \u57fa\u7840\u5730\u56fe\u63cf\u8ff0\n\u533a\u57df\u5730\u56fe\u5e03\u5c40\u5305\u542b\u5165\u53e3\u3001\u5e02\u573a\u3001\u5de5\u574a\u548c\u4e3b\u8def\u3002',
      artStyle: null,
      complete,
    });
    expect(result).toHaveLength(1);
    expect(result[0].sourceHeading).toBe('10. \u57fa\u7840\u5730\u56fe\u63cf\u8ff0');
  });
});
