import type { Storyboard } from './shotScript';

export function castDefinitions(guide: string) {
  if (guide.trim().toLowerCase() === 'none') return [];
  const names = new Set<string>();
  return guide.trim().split(/\r?\n/).filter(line => line.trim()).map(line => {
    const match = /^(.{1,100}?)\s*(?:—|：|:|\s-\s)\s*(.+)$/.exec(line.trim());
    if (!match || names.has(match[1].trim())) throw Error('Use one unique Name — Appearance per line.');
    const name = match[1].trim();
    names.add(name);
    return { name, appearance: line.trim() };
  });
}

export function castIsReady(board: Storyboard) {
  if (!board.characterGuide?.trim() || !board.castSprites) return false;
  try {
    const definitions = castDefinitions(board.characterGuide);
    return definitions.length === board.castSprites.length && definitions.every(d =>
      board.castSprites!.some(sprite => sprite.name === d.name && sprite.appearance === d.appearance));
  } catch { return false; }
}
