import type { ChatMessage } from '@/lib/agent/types';

export const GAME_DESIGN_SYSTEM_SECTIONS = [
  'Design Intent & Player Fantasy',
  'Core Loop',
  'Decision Structure',
  'Rules & System Boundaries',
  'Progression & Economy',
  'Content Model',
  'Difficulty & Balance',
  'Experience & Presentation',
  'Design Principles',
  'Anti-patterns',
  'Keco Table Guidance',
] as const;

export type GameDesignSystemReference = {
  kind: 'document' | 'table' | 'gdd' | 'system';
  label: string;
  projectId?: string;
  resourceId?: string;
};

export type GameDesignSystemReferenceGame = {
  name: string;
  reference: string;
  avoid: string;
};

export type GameDesignSystemInput = {
  title: string;
  genres: string[];
  philosophies: string[];
  description?: string;
  suitableFor?: string;
  baseSystemId?: string;
  baseSystemTitle?: string;
  baseSystemBody?: string;
  pastedMarkdown?: string;
  referenceGames?: GameDesignSystemReferenceGame[];
  references?: GameDesignSystemReference[];
};

export type NormalizedGameDesignSystemInput = Omit<
  GameDesignSystemInput,
  'genres' | 'philosophies' | 'referenceGames' | 'references'
> & {
  genres: string[];
  philosophies: string[];
  referenceGames: GameDesignSystemReferenceGame[];
  references: GameDesignSystemReference[];
};

const clean = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const uniqueStrings = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map(clean).filter((value): value is string => Boolean(value))));
};

export function normalizeGameDesignSystemInput(
  input: Partial<GameDesignSystemInput>,
): NormalizedGameDesignSystemInput {
  const referenceGames = Array.isArray(input.referenceGames)
    ? input.referenceGames
        .map((game) => ({
          name: clean(game?.name) ?? '',
          reference: clean(game?.reference) ?? '',
          avoid: clean(game?.avoid) ?? '',
        }))
        .filter((game) => game.name || game.reference || game.avoid)
    : [];
  const references = Array.isArray(input.references)
    ? input.references
        .map((reference) => ({
          kind: reference?.kind,
          label: clean(reference?.label) ?? '',
          ...(clean(reference?.projectId) ? { projectId: clean(reference.projectId) } : {}),
          ...(clean(reference?.resourceId) ? { resourceId: clean(reference.resourceId) } : {}),
        }))
        .filter((reference): reference is GameDesignSystemReference => (
          (reference.kind === 'document' || reference.kind === 'table' || reference.kind === 'gdd' || reference.kind === 'system')
          && Boolean(reference.label)
        ))
    : [];

  return {
    title: clean(input.title) ?? 'Untitled Game Design System',
    genres: uniqueStrings(input.genres),
    philosophies: uniqueStrings(input.philosophies),
    description: clean(input.description),
    suitableFor: clean(input.suitableFor),
    referenceGames,
    references,
    baseSystemId: clean(input.baseSystemId),
    baseSystemTitle: clean(input.baseSystemTitle),
    baseSystemBody: clean(input.baseSystemBody),
    pastedMarkdown: clean(input.pastedMarkdown),
  };
}

function listOrFallback(values: string[], fallback: string): string {
  return values.length > 0 ? values.join(', ') : fallback;
}

export function buildGameDesignSystemMarkdown(
  rawInput: GameDesignSystemInput,
): string {
  const input = normalizeGameDesignSystemInput(rawInput);
  const referenceLines = input.references.length > 0
    ? input.references.map((reference) => `- ${reference.kind}: ${reference.label}`).join('\n')
    : '- None supplied.';
  const gameLines = input.referenceGames.length > 0
    ? input.referenceGames.map((game) => `- **${game.name}** — Reference: ${game.reference || 'Not specified'}. Avoid: ${game.avoid || 'Not specified'}.`).join('\n')
    : '- None supplied.';
  const principles = input.philosophies.length > 0
    ? input.philosophies.map((philosophy) => `- ${philosophy}`).join('\n')
    : '- Make the player\'s choices legible, consequential, and reversible when appropriate.';

  return [
    `# ${input.title}`,
    '',
    `> Genre: ${listOrFallback(input.genres, 'Unspecified')}`,
    `> Design Philosophy: ${listOrFallback(input.philosophies, 'Unspecified')}`,
    `> Suitable For: ${input.suitableFor ?? 'Single-player and team-authored projects'}`,
    '',
    '## 1. Design Intent & Player Fantasy',
    '',
    input.description ?? 'Define the player fantasy and the emotional promise this system must consistently deliver.',
    '',
    '## 2. Core Loop',
    '',
    'Describe the repeatable moment-to-moment, encounter, and run-level loops.',
    '',
    '## 3. Decision Structure',
    '',
    'Describe the choices players make, the information available, and the tradeoffs that make choices meaningful.',
    '',
    '## 4. Rules & System Boundaries',
    '',
    'State the hard rules, invariants, and boundaries that keep the design coherent.',
    '',
    '## 5. Progression & Economy',
    '',
    'Describe progression, currencies, sinks, sources, and the intended pace of power.',
    '',
    '## 6. Content Model',
    '',
    'Describe reusable content entities and their relationships.',
    '',
    '## 7. Difficulty & Balance',
    '',
    'Describe difficulty curves, balance goals, and how the system communicates risk.',
    '',
    '## 8. Experience & Presentation',
    '',
    'Describe readability, feedback, pacing, accessibility, and presentation rules.',
    '',
    '## 9. Design Principles',
    '',
    principles,
    '',
    '## 10. Anti-patterns',
    '',
    '- Do not add mechanics that obscure the primary decision or undermine the stated player fantasy.',
    '- Do not create progression or economy loops without a clear source, sink, and player-facing explanation.',
    '',
    '## 11. Keco Table Guidance',
    '',
    '- Characters: identity, role, stats, progression hooks.',
    '- Skills: costs, targeting, effects, constraints, and balance tags.',
    '- Items: acquisition, modifiers, rarity, and economy relationships.',
    '- Encounters: setup, objectives, enemies, rewards, and difficulty signals.',
    '- Progression: unlocks, milestones, and pacing values.',
    '- Economy: sources, sinks, currencies, and tuning notes.',
    '',
    '## Source References',
    '',
    referenceLines,
    '',
    '## Reference Games',
    '',
    gameLines,
  ].join('\n');
}

export function buildGameDesignSystemMessages(
  rawInput: GameDesignSystemInput,
): ChatMessage[] {
  const input = normalizeGameDesignSystemInput(rawInput);
  const context = [
    `Title: ${input.title}`,
    `Genres: ${listOrFallback(input.genres, 'Unspecified')}`,
    `Design philosophies: ${listOrFallback(input.philosophies, 'Unspecified')}`,
    `Description: ${input.description ?? 'Not supplied'}`,
    `Suitable for: ${input.suitableFor ?? 'Not supplied'}`,
    `Base system: ${input.baseSystemTitle ?? input.baseSystemId ?? 'None'}`,
    input.baseSystemBody ? `Base system Markdown:\n${input.baseSystemBody}` : '',
    input.pastedMarkdown ? `Pasted GAME_DESIGN_SYSTEM.md:\n${input.pastedMarkdown}` : '',
    input.references.length > 0
      ? `Project references:\n${input.references.map((reference) => `- ${reference.kind}: ${reference.label}`).join('\n')}`
      : 'Project references: None',
    input.referenceGames.length > 0
      ? `Reference games:\n${input.referenceGames.map((game) => `- ${game.name}: reference ${game.reference || 'unspecified'}; avoid ${game.avoid || 'unspecified'}`).join('\n')}`
      : 'Reference games: None',
  ].filter(Boolean).join('\n\n');

  return [
    {
      role: 'system',
      content: [
        'You are Keco Studio\'s Game Design System architect.',
        'Create a complete, reusable GAME_DESIGN_SYSTEM.md for game designers.',
        'Use the requested genres and philosophies as constraints, not decoration.',
        `The Markdown MUST contain exactly these substantive sections: ${GAME_DESIGN_SYSTEM_SECTIONS.join('; ')}.`,
        'Preserve useful source constraints while synthesizing a coherent system.',
        'Do not copy protected game content or claim references are official.',
        'Return only Markdown. Do not wrap the response in JSON, code fences, or commentary.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Generate the system from these inputs. Return only Markdown.\n\n${context}`,
    },
  ];
}

export function missingGameDesignSystemSections(markdown: string): string[] {
  const normalized = markdown.toLowerCase();
  return GAME_DESIGN_SYSTEM_SECTIONS.filter((section) => (
    !normalized.includes(section.toLowerCase())
  ));
}

export function validateGameDesignSystemMarkdown(markdown: string): { ok: true } | { ok: false; missing: string[] } {
  const missing = missingGameDesignSystemSections(markdown);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
