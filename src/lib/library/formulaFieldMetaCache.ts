export interface FormulaFieldMetaCache<T> {
  get(libraryId: string): Promise<T[]>;
  invalidate(libraryId: string): void;
  clear(): void;
}

export function createFormulaFieldMetaCache<T>(
  fetcher: (libraryId: string) => Promise<T[]>
): FormulaFieldMetaCache<T> {
  const entries = new Map<string, Promise<T[]>>();

  return {
    get(libraryId: string): Promise<T[]> {
      let entry = entries.get(libraryId);
      if (!entry) {
        entry = fetcher(libraryId).catch((error) => {
          entries.delete(libraryId);
          throw error;
        });
        entries.set(libraryId, entry);
      }
      return entry;
    },

    invalidate(libraryId: string): void {
      entries.delete(libraryId);
    },

    clear(): void {
      entries.clear();
    },
  };
}
