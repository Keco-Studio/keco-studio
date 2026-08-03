import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import {
  battleActorPercentPosition,
  battleActorSize,
  battleCanvasMetrics,
  battleGridToScreen,
} from '@/components/simulation/arena/battleViewport';

const read = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('battle responsive layout', () => {
  it('sizes an active battle from the workbench content box without a fixed minimum height', () => {
    const screen = read('src/components/simulation/workbench/BattleScreen.tsx');
    const arena = read('src/components/simulation/arena/BattleArena/BattleArena.tsx');
    const styles = read('src/components/simulation/workbench/SimulationWorkbench.module.css');

    expect(screen).toContain('className={styles.activeBattleArena}');
    expect(screen).not.toContain('minHeight: 520');
    expect(styles).toMatch(/\.content\s*\{[\s\S]*?position:\s*relative/);
    expect(styles).toMatch(/\.activeBattleArena\s*\{[\s\S]*?position:\s*absolute[\s\S]*?inset:\s*0[\s\S]*?min-height:\s*0/);
    expect(arena).toContain("fit: 'cover'");
  });

  it('scales the canvas backing store when browser zoom changes device pixel ratio', () => {
    expect(battleCanvasMetrics({ width: 640.8, height: 360.4 }, 1)).toEqual({
      width: 640,
      height: 360,
      pixelRatio: 1,
      backingWidth: 640,
      backingHeight: 360,
    });
    expect(battleCanvasMetrics({ width: 640.8, height: 360.4 }, 2)).toEqual({
      width: 640,
      height: 360,
      pixelRatio: 2,
      backingWidth: 1280,
      backingHeight: 720,
    });
  });

  it('lets actors shrink with small map cells instead of locking them to 32px', () => {
    expect(battleActorSize(12)).toBe(18);
    expect(battleActorSize(4)).toBe(6);
    expect(battleActorSize(0.2)).toBe(1);
    expect(battleActorSize(28)).toBe(42);
  });

  it('maps continuous battle coordinates without adding a second half-cell offset', () => {
    expect(battleGridToScreen({
      x: 0.5,
      y: 15.5,
      mapWidth: 16,
      mapHeight: 16,
      renderWidth: 320,
      renderHeight: 320,
      renderOffsetX: 40,
      renderOffsetY: 10,
    })).toEqual({ x: 50, y: 320 });
  });

  it('renders the canvas, actors, and effects in one shared map layer', () => {
    const arena = read('src/components/simulation/arena/BattleArena/BattleArena.tsx');
    const arenaStyles = read('src/components/simulation/arena/BattleArena/BattleArena.module.css');
    const layerIndex = arena.indexOf('className={styles.mapLayer}');
    const canvasIndex = arena.indexOf('<canvas', layerIndex);
    const overlayIndex = arena.indexOf('className={styles.overlay}', canvasIndex);
    const effectsIndex = arena.indexOf('<MapFxOverlay', overlayIndex);

    expect(layerIndex).toBeGreaterThan(-1);
    expect(canvasIndex).toBeGreaterThan(layerIndex);
    expect(overlayIndex).toBeGreaterThan(canvasIndex);
    expect(effectsIndex).toBeGreaterThan(overlayIndex);
    expect(arena).toContain('gridToScreen={gridToMapScreen}');
    expect(arena).toContain('style={actorPositionStyle(left.position)}');
    expect(arenaStyles).toMatch(/\.viewport\s*\{[\s\S]*?container-type:\s*size/);
    expect(arenaStyles).toMatch(/\.mapLayer\s*\{[\s\S]*?width:\s*max\(100cqw,\s*calc\(100cqh \* var\(--battle-map-aspect\)\)\)/);
  });

  it('starts viewport measurement after the async battle session mounts the map', () => {
    const arena = read('src/components/simulation/arena/BattleArena/BattleArena.tsx');

    expect(arena).toContain('const hasSession = session !== null;');
    expect(arena).toContain('}, [measureViewport, hasSession]);');
  });

  it('expresses actor positions as percentages within the map layer', () => {
    expect(battleActorPercentPosition({
      x: 15.5,
      y: 0.5,
      mapWidth: 16,
      mapHeight: 16,
      actorCells: 1.5,
    })).toEqual({ left: '95.3125%', top: '4.6875%' });
  });
});
