import {
  AGENT_LAUNCHER_SIZE,
  AGENT_LAUNCHER_STORAGE_KEY,
  clampLauncherPosition,
  readStoredLauncherPosition,
  writeStoredLauncherPosition,
  type LauncherPosition,
} from '@/components/agent/draggableLauncherPosition';

describe('clampLauncherPosition', () => {
  it('keeps values inside the viewport', () => {
    expect(clampLauncherPosition(10, 20, 400, 300)).toEqual({ left: 10, top: 20 });
  });

  it('clamps negative and overflowing coordinates', () => {
    expect(clampLauncherPosition(-40, -10, 400, 300)).toEqual({ left: 0, top: 0 });
    expect(clampLauncherPosition(999, 999, 400, 300)).toEqual({
      left: 400 - AGENT_LAUNCHER_SIZE,
      top: 300 - AGENT_LAUNCHER_SIZE,
    });
  });
});

describe('stored launcher position', () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const data = { ...initial };
    return {
      getItem: (key: string) => (key in data ? data[key] : null),
      setItem: (key: string, value: string) => {
        data[key] = value;
      },
    };
  }

  it('returns null for missing or invalid payloads', () => {
    expect(readStoredLauncherPosition(memoryStorage())).toBeNull();
    expect(
      readStoredLauncherPosition(
        memoryStorage({ [AGENT_LAUNCHER_STORAGE_KEY]: 'not-json' }),
      ),
    ).toBeNull();
    expect(
      readStoredLauncherPosition(
        memoryStorage({
          [AGENT_LAUNCHER_STORAGE_KEY]: JSON.stringify({ left: 'a', top: 1 }),
        }),
      ),
    ).toBeNull();
  });

  it('round-trips a valid position', () => {
    const storage = memoryStorage();
    const position: LauncherPosition = { left: 120, top: 80 };
    writeStoredLauncherPosition(position, storage);
    expect(readStoredLauncherPosition(storage)).toEqual(position);
  });
});
