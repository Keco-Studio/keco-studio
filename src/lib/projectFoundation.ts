export const PROJECT_FOUNDATION_TAG_LIMIT = 20;

export const GAME_GENRE_PRESETS = [
  'RPG', 'Strategy', 'Deckbuilder', 'Roguelike', 'Simulation', 'Narrative',
  'Action', 'Puzzle', 'Management', 'Adventure', 'Platformer', 'Shooter',
  'Survival', 'Horror', 'Sandbox', 'Sports', 'Visual Novel', 'Metroidvania',
] as const;

export const DESIGN_PHILOSOPHY_PRESETS = [
  'Meaningful Decisions', 'Readable Systems', 'System Driven', 'Narrative First',
  'Player Agency', 'Emergent Play', 'Competitive Fairness',
  'Expressive Customization', 'Accessibility First',
  'Easy to Learn, Hard to Master', 'Risk and Reward', 'Fail Forward',
  'Mastery Through Practice', 'Cooperative Play',
] as const;

export type ProjectFoundationDraft = {
  name: string;
  genres: string[];
  designPhilosophies: string[];
  description: string;
};

export function normalizeFoundationTag(value: string, presets: readonly string[]): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return presets.find((preset) => preset.toLowerCase() === normalized.toLowerCase()) ?? normalized;
}

export function normalizeFoundationTags(values: readonly string[], presets: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeFoundationTag(value, presets);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length === PROJECT_FOUNDATION_TAG_LIMIT) break;
  }
  return result;
}
