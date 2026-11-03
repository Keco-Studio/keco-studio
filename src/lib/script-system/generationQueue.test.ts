import { GenerationQueue } from './generationQueue';

test('canceling a queued or dependent job sends no request; canceling a running job frees a slot for unrelated work', async () => {
  const queue = new GenerationQueue(() => {}, 1);
  let startedSignal: AbortSignal | undefined;
  const active = queue.add('parent', signal => new Promise<void>((_, reject) => {
    startedSignal = signal;
    signal.addEventListener('abort', () => reject(signal.reason), {once:true});
  }));
  const unused = jest.fn(async () => {});
  const child = queue.add('child', unused, active);
  const waiting = queue.add('queued', unused);
  const siblingTask = jest.fn(async () => {});
  const sibling = queue.add('sibling', siblingTask);
  expect(queue.get('parent')).toBe(active);
  const statuses = Promise.allSettled([active, child, waiting, sibling]);
  queue.cancel('queued');
  queue.cancel('parent');
  expect(startedSignal?.aborted).toBe(true);
  expect((await statuses).map(r => r.status)).toEqual(['rejected','rejected','rejected','fulfilled']);
  expect(unused).not.toHaveBeenCalled();
  expect(siblingTask).toHaveBeenCalledTimes(1);
});

test('a canceled dependency waiter can retry immediately without the old parent starting it again', async () => {
  const queue = new GenerationQueue(() => {});
  let finish!: () => void;
  const parent = new Promise<void>(resolve => { finish = resolve; });
  const skipped = jest.fn(async () => {});
  const old = queue.add('shot', skipped, parent);
  const outcome = Promise.allSettled([old]);
  queue.cancel('shot');
  const retry = jest.fn(async () => {});
  await queue.add('shot', retry);
  finish();
  expect((await outcome)[0].status).toBe('rejected');
  expect(skipped).not.toHaveBeenCalled();
  expect(retry).toHaveBeenCalledTimes(1);
});
