import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { DirectMapCanvas } from '@/features/create-map/components/DirectMapCanvas';
import { makeEmptyMapSceneV3, makeValidMapPlanV3 } from './fixtures';

jest.mock('@/features/create-map/CreateMapWorkbench.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

describe('DirectMapCanvas', () => {
  it('renders only the exact ready stored image binding', () => {
    const plan = makeValidMapPlanV3();
    const scene = {
      ...makeEmptyMapSceneV3(),
      mapImage: {
        assetKey: 'map-image' as const,
        sourceRevisionId: '10000000-0000-4000-8000-000000000010',
        width: 512,
        height: 512,
        locked: true as const,
      },
    };
    const markup = renderToStaticMarkup(React.createElement(DirectMapCanvas, {
      plan, scene,
      image: {
        sourceRevisionId: scene.mapImage.sourceRevisionId,
        sha256: 'a'.repeat(64),
        signedUrl: '/signed-map.png',
        width: 512,
        height: 512,
      },
    }));

    expect(markup).toContain('src="/signed-map.png"');
    expect(markup).toContain(`alt="${plan.name}"`);
    expect(markup).toContain('data-image-binding=');
  });

  it('shows an empty state for a missing or stale image binding', () => {
    const plan = makeValidMapPlanV3();
    const scene = {
      ...makeEmptyMapSceneV3(),
      mapImage: {
        assetKey: 'map-image' as const,
        sourceRevisionId: '10000000-0000-4000-8000-000000000010',
        width: 512,
        height: 512,
        locked: true as const,
      },
    };
    const markup = renderToStaticMarkup(React.createElement(DirectMapCanvas, {
      plan,
      scene,
      image: {
        sourceRevisionId: '10000000-0000-4000-8000-000000000099',
        sha256: 'b'.repeat(64),
        signedUrl: '/stale-map.png',
        width: 512,
        height: 512,
      },
    }));

    expect(markup).toContain('Map preview');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('/stale-map.png');
  });

  it('rejects ready image metadata that does not match the locked dimensions', () => {
    const plan = makeValidMapPlanV3();
    const scene = {
      ...makeEmptyMapSceneV3(),
      mapImage: {
        assetKey: 'map-image' as const,
        sourceRevisionId: '10000000-0000-4000-8000-000000000010',
        width: 512,
        height: 512,
        locked: true as const,
      },
    };
    const markup = renderToStaticMarkup(React.createElement(DirectMapCanvas, {
      plan,
      scene,
      image: {
        sourceRevisionId: scene.mapImage.sourceRevisionId,
        sha256: 'c'.repeat(64),
        signedUrl: '/wrong-size.png',
        width: 688,
        height: 384,
      },
    }));

    expect(markup).toContain('Map preview');
    expect(markup).not.toContain('/wrong-size.png');
  });
});
