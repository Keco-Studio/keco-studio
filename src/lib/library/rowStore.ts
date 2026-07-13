import type { AssetRow } from '@/lib/types/libraryAssets';

export class ObservableRowStore {
  private rows: AssetRow[] = [];
  private snapshot: readonly AssetRow[] = [];
  private listeners = new Set<() => void>();
  private transactionDepth = 0;
  private dirty = false;

  get length(): number {
    return this.rows.length;
  }

  getSnapshot = (): readonly AssetRow[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  toArray(): AssetRow[] {
    return [...this.rows];
  }

  insert(index: number, rows: AssetRow[]): void {
    if (rows.length === 0) return;
    this.rows.splice(index, 0, ...rows);
    this.markDirty();
  }

  delete(index: number, count: number): void {
    if (count <= 0 || index < 0 || index >= this.rows.length) return;
    this.rows.splice(index, count);
    this.markDirty();
  }

  replace(rows: AssetRow[]): void {
    this.rows = [...rows];
    this.markDirty();
  }

  transact(callback: () => void): void {
    this.transactionDepth += 1;
    try {
      callback();
    } finally {
      this.transactionDepth -= 1;
      if (this.transactionDepth === 0 && this.dirty) this.publish();
    }
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.transactionDepth === 0) this.publish();
  }

  private publish(): void {
    this.dirty = false;
    this.snapshot = [...this.rows];
    this.listeners.forEach((listener) => listener());
  }
}
