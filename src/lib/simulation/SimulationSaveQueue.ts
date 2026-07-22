import type { SimulationSaveResult, SimulationStorageError } from './storage';
import type { SimulationStateV1 } from './types';

interface SimulationSaveQueueOptions {
  readonly revision: number;
  readonly save: (revision: number, state: SimulationStateV1) => Promise<SimulationSaveResult>;
  readonly onSaved: (revision: number, dirty: boolean) => void;
  readonly onUnsaved: (error: SimulationStorageError) => void;
  readonly onConflict: (error: SimulationStorageError) => void;
}

export class SimulationSaveQueue {
  private revision: number;
  private pending: SimulationStateV1 | null = null;
  private failed: SimulationStateV1 | null = null;
  private inFlight = false;
  private blocked = false;
  private stopped = false;

  constructor(private readonly options: SimulationSaveQueueOptions) {
    this.revision = options.revision;
  }

  enqueue(state: SimulationStateV1): void {
    if (this.stopped || this.blocked) return;
    this.pending = state;
    this.failed = null;
    void this.flush();
  }

  retry(): void {
    if (this.stopped || this.blocked || this.inFlight) return;
    if (!this.pending && this.failed) {
      this.pending = this.failed;
      this.failed = null;
    }
    void this.flush();
  }

  stop(): void {
    this.stopped = true;
    this.pending = null;
    this.failed = null;
  }

  isDirty(): boolean {
    return !this.stopped && (this.inFlight || this.pending !== null || this.failed !== null);
  }

  getRevision(): number {
    return this.revision;
  }

  private async flush(): Promise<void> {
    if (this.stopped || this.blocked || this.inFlight || !this.pending) return;
    const snapshot = this.pending;
    this.pending = null;
    this.inFlight = true;

    const result = await this.options.save(this.revision, snapshot);
    if (this.stopped) return;
    this.inFlight = false;

    if (result.ok) {
      this.revision = result.revision;
      this.failed = null;
      this.options.onSaved(this.revision, this.isDirty());
      await this.flush();
      return;
    }

    if (result.error.code === 'conflict') {
      this.blocked = true;
      this.pending = null;
      this.failed = null;
      this.options.onConflict(result.error);
      return;
    }

    if (!this.pending) this.failed = snapshot;
    this.options.onUnsaved(result.error);
  }
}
