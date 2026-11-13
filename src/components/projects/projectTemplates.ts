export type ProjectTemplateKey =
  | 'blank'
  | 'tactical-deckbuilder'
  | 'narrative-adventure'
  | 'survival-builder'
  | 'management-simulation'
  | 'action-roguelike'
  | 'cooperative-puzzle';

export type ProjectTemplateDefinition = {
  key: ProjectTemplateKey;
  name: string;
  description: string;
  icon: 'blank' | 'cards' | 'story' | 'survival' | 'management' | 'action' | 'cooperative';
  availability: 'available' | 'coming-soon';
};

export const DEFAULT_PROJECT_TEMPLATE_KEY: ProjectTemplateKey = 'blank';

export const PROJECT_TEMPLATES: readonly ProjectTemplateDefinition[] = [
  { key: 'blank', name: 'Blank project', description: 'An empty workspace for a custom structure.', icon: 'blank', availability: 'available' },
  { key: 'tactical-deckbuilder', name: 'Tactical deckbuilder', description: 'Card synergies, encounter pacing, and progression.', icon: 'cards', availability: 'available' },
  { key: 'narrative-adventure', name: 'Narrative adventure', description: 'Characters, branching choices, and consequences.', icon: 'story', availability: 'coming-soon' },
  { key: 'survival-builder', name: 'Survival builder', description: 'Gathering, crafting, survival pressure, and base growth.', icon: 'survival', availability: 'coming-soon' },
  { key: 'management-simulation', name: 'Management simulation', description: 'Resources, production chains, and long-term tradeoffs.', icon: 'management', availability: 'coming-soon' },
  { key: 'action-roguelike', name: 'Action roguelike', description: 'Responsive combat, run variation, and meta progression.', icon: 'action', availability: 'coming-soon' },
  { key: 'cooperative-puzzle', name: 'Cooperative puzzle', description: 'Shared information, complementary roles, and communication.', icon: 'cooperative', availability: 'coming-soon' },
] as const;
