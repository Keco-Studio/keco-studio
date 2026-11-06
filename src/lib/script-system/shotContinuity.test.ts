import { example } from './shotScript';
import { shotContinuity } from './shotContinuity';

it('generates parents first and never uses artwork from a sibling branch', () => {
  const [opening, door, wait] = structuredClone(example.shots);
  const merge = { ...wait, id: 'merge' };
  opening.artwork = 'opening';
  door.artwork = 'door';
  door.exits = [{ label: '', target: merge.id }];
  wait.exits = [{ label: '', target: merge.id }];
  merge.exits = [{ label: 'Replay', target: opening.id }];
  const { order, context } = shotContinuity({ ...example, shots: [opening, merge, wait, door] });
  expect(order.map(s => s.id)).toEqual(['start', 'door', 'wait', 'merge']);
  expect(context('start').beats).toEqual([]);
  expect(context('wait').referenceId).toBe('start');
  expect(context('wait').beats.join(' ')).not.toContain(door.line);
  expect(context('merge').referenceId).toBe('door');
});
