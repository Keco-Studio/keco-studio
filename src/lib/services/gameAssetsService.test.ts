import {
  countAssetCategories,
  normalizeCharacterAsset,
  normalizeManualImage,
  normalizeMapAsset,
  type ProjectGameAsset,
} from './gameAssetsService';

const projectId = '11111111-1111-4111-8111-111111111111';

describe('game asset normalization', () => {
  it('normalizes a verified manual image without using its URL as identity', () => {
    const asset = normalizeManualImage({
      id: 'asset-1',
      project_id: projectId,
      name: 'hero.png',
      mime_type: 'image/png',
      storage_path: `${projectId}/hero.png`,
      sha256: 'a'.repeat(64),
      width: 128,
      height: 128,
      file_size: 1024,
      created_at: '2026-09-09T00:00:00.000Z',
      updated_at: '2026-09-09T00:00:00.000Z',
    });

    expect(asset).toMatchObject({
      id: 'manual:asset-1',
      projectId,
      category: 'media',
      source: 'manual',
      storageBucket: 'library-media-files',
      storagePath: `${projectId}/hero.png`,
      sha256: 'a'.repeat(64),
      previewUrl: null,
    });
    expect(asset).not.toHaveProperty('url');
  });

  it('maps generated map and character states to the shared contract', () => {
    const map = normalizeMapAsset({
      id: 'map-asset-1',
      asset_key: 'terrain-main',
      kind: 'terrain',
      status: 'generating',
      storage_path: null,
      sha256: null,
      width: null,
      height: null,
      has_transparency: null,
      created_at: '2026-09-09T00:00:00.000Z',
      updated_at: '2026-09-09T00:00:00.000Z',
      map_project_id: 'map-project-1',
      map_name: 'Forest',
      project_id: projectId,
      plan: { map: { width: 640, height: 320 } },
    });
    const character = normalizeCharacterAsset({
      id: 'char-1',
      project_id: projectId,
      kind: 'animation',
      name: 'Run',
      status: 'ready',
      created_at: '2026-09-09T00:00:00.000Z',
      updated_at: '2026-09-09T00:00:00.000Z',
      generation: {
        id: 'attempt-1',
        status: 'ready',
        storage_path: 'char/path.png',
        sha256: 'b'.repeat(64),
        width: 256,
        height: 64,
        has_transparency: true,
        metadata: { fileSize: 2048 },
        created_at: '2026-09-09T00:00:00.000Z',
        updated_at: '2026-09-09T00:00:00.000Z',
      },
    });

    expect(map).toMatchObject({
      id: 'map:map-asset-1',
      name: 'Forest',
      category: 'map',
      status: 'generating',
      width: 640,
      height: 320,
    });
    expect(character).toMatchObject({
      id: 'character:char-1',
      category: 'spritesheet',
      source: 'animation-generation',
      status: 'ready',
      width: 256,
    });
  });

  it('counts semantic categories, including an all-assets total', () => {
    const assets = [
      { category: 'map' },
      { category: 'character' },
      { category: 'spritesheet' },
      { category: 'media' },
    ] as ProjectGameAsset[];
    expect(countAssetCategories(assets)).toEqual({
      all: 4,
      character: 1,
      icon: 0,
      ui: 0,
      map: 1,
      prop: 0,
      vfx: 0,
      spritesheet: 1,
      media: 1,
    });
  });
});
