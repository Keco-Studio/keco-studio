import { describe, expect, it, jest } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AssetRow } from '@/lib/types/libraryAssets';

const asset = (id: string): AssetRow => ({
  id,
  libraryId: 'library-1',
  name: id,
  propertyValues: {},
});

describe('plain library stores (issue #214)', () => {
  it('publishes one immutable asset snapshot per transaction', () => {
    const modulePath = path.join(process.cwd(), 'src/lib/library/assetStore.ts');
    expect(existsSync(modulePath)).toBe(true);
    if (!existsSync(modulePath)) return;
    const { ObservableAssetStore } = require(modulePath) as {
      ObservableAssetStore: new () => any;
    };
    const store = new ObservableAssetStore();
    const listener = jest.fn();
    store.subscribe(listener);

    store.transact(() => {
      store.set(asset('one'));
      store.set(asset('two'));
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(Array.from(store.getSnapshot().keys())).toEqual(['one', 'two']);
  });

  it('supports observable placeholder row insertion and replacement', () => {
    const modulePath = path.join(process.cwd(), 'src/lib/library/rowStore.ts');
    expect(existsSync(modulePath)).toBe(true);
    if (!existsSync(modulePath)) return;
    const { ObservableRowStore } = require(modulePath) as {
      ObservableRowStore: new () => any;
    };
    const store = new ObservableRowStore();
    const listener = jest.fn();
    store.subscribe(listener);

    store.insert(0, [asset('temp-insert-1')]);
    store.delete(0, 1);
    store.insert(0, [asset('real-1')]);

    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.toArray().map((row) => row.id)).toEqual(['real-1']);
  });

  it('removes Yjs from the library store path', () => {
    const root = process.cwd();
    for (const file of [
      'src/lib/library/yjsAssetHydration.ts',
      'src/lib/contexts/YjsContext.tsx',
      'src/lib/hooks/useYjsRows.ts',
      'src/components/libraries/hooks/useYjsSync.ts',
    ]) {
      expect(existsSync(path.join(root, file))).toBe(false);
    }
    expect(readFileSync(path.join(root, 'src/lib/library/assetStore.ts'), 'utf8')).not.toMatch(
      /from ['"]yjs['"]/
    );
    expect(readFileSync(path.join(root, 'src/lib/library/rowStore.ts'), 'utf8')).not.toMatch(
      /from ['"]yjs['"]/
    );
  });
});
