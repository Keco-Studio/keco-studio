import { describe, expect, it } from '@jest/globals';
import { renderMapScene, type MapRenderAsset } from '@/features/create-map/components/MapCanvas';
import { makeValidMapSceneV2 } from './fixtures';

jest.mock('@/features/create-map/CreateMapWorkbench.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

type RecordedImage = CanvasImageSource & { kind: 'background' | 'obstacle' };

function image(kind: RecordedImage['kind']): RecordedImage {
  return { kind } as RecordedImage;
}

function recordCanvasCalls() {
  const events: string[] = [];
  const draws: Array<{ source: RecordedImage; args: number[] }> = [];
  const context = {
    canvas: { width: 800, height: 600 },
    save: () => events.push('save'),
    restore: () => events.push('restore'),
    setTransform: () => undefined,
    clearRect: () => undefined,
    fillRect: () => undefined,
    drawImage: (source: RecordedImage, ...args: number[]) => {
      draws.push({ source, args });
      events.push(`draw:${source.kind}`);
    },
    translate: () => undefined,
    rotate: () => undefined,
    scale: () => undefined,
    beginPath: () => undefined,
    rect: () => undefined,
    arc: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    closePath: () => undefined,
    fill: () => events.push('fill'),
    stroke: () => events.push('stroke'),
    setLineDash: () => undefined,
    strokeRect: () => events.push('selection'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
  return { context, draws, events };
}

function assets(): ReadonlyMap<string, MapRenderAsset> {
  return new Map([
    ['composed-background', { assetKey: 'composed-background', kind: 'background', image: image('background'), width: 256, height: 192 }],
    ['mossy-rock', { assetKey: 'mossy-rock', kind: 'obstacle', image: image('obstacle'), width: 32, height: 40 }],
  ]);
}

describe('Create Map V2 canvas renderer', () => {
  it('draws the complete locked background once before z-ordered obstacle entities', () => {
    const scene = makeValidMapSceneV2();
    scene.layers.find((layer) => layer.id === 'collision')!.visible = true;
    const calls = recordCanvasCalls();

    renderMapScene(calls.context, scene, assets(), { zoom: 1, panX: 0, panY: 0, devicePixelRatio: 2 }, { kind: 'entity', id: 'rock-1' });

    expect(calls.draws[0]).toEqual({ source: expect.objectContaining({ kind: 'background' }), args: [0, 0, 128, 96] });
    expect(calls.draws[1]).toEqual({ source: expect.objectContaining({ kind: 'obstacle' }), args: [-16, -28, 32, 40] });
    expect(calls.events.indexOf('draw:background')).toBeLessThan(calls.events.indexOf('draw:obstacle'));
    expect(calls.events).toContain('fill');
    expect(calls.events).toContain('stroke');
  });

  it('respects fixed layer visibility and never draws hidden background or obstacle pixels', () => {
    const scene = makeValidMapSceneV2();
    scene.layers.find((layer) => layer.id === 'background')!.visible = false;
    scene.layers.find((layer) => layer.id === 'obstacles')!.visible = false;
    const calls = recordCanvasCalls();

    renderMapScene(calls.context, scene, assets(), { zoom: 1, panX: 0, panY: 0, devicePixelRatio: 1 });

    expect(calls.draws).toEqual([]);
  });

  it('renders collision overlays only when the collision concern is visible', () => {
    const scene = makeValidMapSceneV2();
    const hidden = recordCanvasCalls();
    renderMapScene(hidden.context, scene, assets(), { zoom: 1, panX: 0, panY: 0, devicePixelRatio: 1 });
    expect(hidden.events).not.toContain('stroke');

    scene.layers.find((layer) => layer.id === 'collision')!.visible = true;
    const shown = recordCanvasCalls();
    renderMapScene(shown.context, scene, assets(), { zoom: 1, panX: 0, panY: 0, devicePixelRatio: 1 });
    expect(shown.events).toContain('stroke');
  });
});
