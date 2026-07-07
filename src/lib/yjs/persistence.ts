import { clearDocument as clearYjsIndexeddbDocument } from 'y-indexeddb';

export type ResettablePersistence = {
  destroy: () => Promise<void> | void;
};

export type RepopulateWithResetPersistenceOptions<TPersistence extends ResettablePersistence> = {
  persistenceName: string;
  currentPersistence: TPersistence | null | undefined;
  createPersistence: () => TPersistence;
  clearDocument?: (name: string) => Promise<unknown> | unknown;
  repopulate: (persistence: TPersistence) => Promise<void> | void;
};

export async function repopulateWithResetPersistence<TPersistence extends ResettablePersistence>({
  persistenceName,
  currentPersistence,
  createPersistence,
  clearDocument = clearYjsIndexeddbDocument,
  repopulate,
}: RepopulateWithResetPersistenceOptions<TPersistence>): Promise<TPersistence> {
  if (currentPersistence) {
    await currentPersistence.destroy();
  }

  await clearDocument(persistenceName);

  const nextPersistence = createPersistence();
  await repopulate(nextPersistence);
  return nextPersistence;
}
