export type QueueState = 'Waiting for previous shot' | 'Queued' | 'Generating';
export type QueueRow = { key: string; state: QueueState };
type Job = QueueRow & {
  controller: AbortController;
  task: (signal: AbortSignal) => Promise<void>;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

export class GenerationQueue {
  private jobs = new Map<string, Job>();
  private running = 0;

  constructor(private publish: (rows: QueueRow[]) => void, private limit = 3) {}

  get(key: string) { return this.jobs.get(key)?.promise; }

  add(key: string, task: Job['task'], dependency?: Promise<void>): Promise<void> {
    const existing = this.get(key);
    if (existing) return existing;
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const job: Job = { key, task, promise, resolve, reject, controller: new AbortController(),
      state: dependency ? 'Waiting for previous shot' : 'Queued' };
    this.jobs.set(key, job);
    this.notify();
    if (dependency) {
      dependency.then(() => {
        if (job.controller.signal.aborted) return;
        job.state = 'Queued';
        this.notify();
        this.drain();
      }, () => this.cancelJob(job, 'Skipped because the previous shot did not finish.'));
    } else this.drain();
    return promise;
  }

  cancel(key: string) {
    const job = this.jobs.get(key);
    if (job) this.cancelJob(job, 'Generation canceled.');
  }

  cancelAll() {
    for (const job of this.jobs.values()) this.cancelJob(job, 'Generation canceled.');
  }

  private cancelJob(job: Job, message: string) {
    if (this.jobs.get(job.key) !== job) return;
    job.controller.abort();
    this.jobs.delete(job.key);
    job.reject(new Error(message));
    this.notify();
  }

  private notify() {
    this.publish(Array.from(this.jobs.values(), ({key, state}) => ({key, state})));
  }

  private drain() {
    for (const job of this.jobs.values()) {
      if (this.running >= this.limit) break;
      if (job.state !== 'Queued') continue;
      this.running++;
      job.state = 'Generating';
      this.notify();
      void this.run(job);
    }
  }

  private async run(job: Job) {
    try {
      await job.task(job.controller.signal);
      job.resolve();
    } catch (error) { job.reject(error); }
    finally {
      this.running--;
      if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
      this.notify();
      this.drain();
    }
  }
}
