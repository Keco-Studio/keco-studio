import { describe, expect, it } from '@jest/globals';
import { repopulateWithResetPersistence } from '@/lib/yjs/persistence';

type FakePersistence = {
  name: string;
  destroy: () => Promise<void>;
  appendUpdate: (update: string) => void;
};

describe('repopulateWithResetPersistence', () => {
  it('bounds persisted updates across repeated repopulates by clearing the store first', async () => {
    const store = new Map<string, string[]>();
    const destroyed: string[] = [];
    const persistenceName = 'library-lib-1';
    let currentPersistence: FakePersistence | null = null;

    const createPersistence = (): FakePersistence => {
      if (!store.has(persistenceName)) {
        store.set(persistenceName, []);
      }

      return {
        name: persistenceName,
        destroy: async () => {
          destroyed.push(persistenceName);
        },
        appendUpdate: (update: string) => {
          store.get(persistenceName)?.push(update);
        },
      };
    };

    for (let i = 1; i <= 5; i += 1) {
      currentPersistence = await repopulateWithResetPersistence({
        persistenceName,
        currentPersistence,
        createPersistence,
        clearDocument: async (name) => {
          store.set(name, []);
        },
        repopulate: (persistence) => {
          persistence.appendUpdate(`clear-${i}`);
          persistence.appendUpdate(`row-a-${i}`);
          persistence.appendUpdate(`row-b-${i}`);
        },
      });

      expect(store.get(persistenceName)).toHaveLength(3);
    }

    expect(store.get(persistenceName)).toEqual(['clear-5', 'row-a-5', 'row-b-5']);
    expect(destroyed).toHaveLength(4);
  });
});
