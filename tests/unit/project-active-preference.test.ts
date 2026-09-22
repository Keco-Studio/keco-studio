import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  readCreateMapProjectPreference,
  writeCreateMapProjectPreference,
} from '@/lib/create-map/projectPreference';
import {
  readSimulationProjectPreference,
} from '@/lib/simulation/projectPreference';
import {
  readScriptProjectPreference,
} from '@/lib/script-system/projectPreference';

describe('active project preference', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: globalThis.localStorage,
        dispatchEvent: () => true,
      },
    });
  });

  it('uses a Map project selection in Simulator and Script', () => {
    writeCreateMapProjectPreference({
      projectId: 'project-1',
      projectName: 'Shared project',
    });

    expect(readCreateMapProjectPreference()).toEqual({
      projectId: 'project-1',
      projectName: 'Shared project',
    });
    expect(readSimulationProjectPreference()).toEqual({
      projectId: 'project-1',
      projectName: 'Shared project',
    });
    expect(readScriptProjectPreference()).toEqual({
      projectId: 'project-1',
      projectName: 'Shared project',
    });
  });
});
