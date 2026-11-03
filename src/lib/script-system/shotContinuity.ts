import type { Storyboard } from './shotScript';

// A merge needs one representative frame. Take the shortest path from the
// opening shot, breaking ties by the author's choice order.
export function shotContinuity(board: Storyboard) {
  const byId = new Map(board.shots.map(shot => [shot.id, shot]));
  const parents = new Map<string, { id: string; choice: string }>();
  const visited = new Set<string>();
  const order: Storyboard['shots'] = [];
  for (const root of board.shots) {
    if (visited.has(root.id)) continue;
    visited.add(root.id);
    const queue = [root];
    for (let i = 0; i < queue.length; i++) {
      const shot = queue[i];
      order.push(shot);
      for (const exit of shot.exits) {
        const child = exit.target && byId.get(exit.target);
        if (!child || visited.has(child.id)) continue;
        visited.add(child.id);
        parents.set(child.id, { id: shot.id, choice: exit.label });
        queue.push(child);
      }
    }
  }
  function context(id: string) {
    const beats: string[] = [];
    let referenceId: string | undefined;
    for (let edge = parents.get(id); edge; edge = parents.get(edge.id)) {
      const parent = byId.get(edge.id)!;
      if (!referenceId && parent.artwork) referenceId = parent.id;
      if (beats.length < 4) beats.unshift([parent.scene, parent.speaker, parent.line.slice(0, 200), edge.choice].filter(Boolean).join(' / '));
    }
    return { beats, referenceId };
  }
  return { order, context };
}
